import { createHmac, timingSafeEqual } from 'node:crypto';
import { WhatsAppConfigurationError, WhatsAppWebhookError } from './errors.js';
import type {
  IncomingMedia,
  MessageEvent,
  StatusEvent,
  WebhookRequest,
  WhatsAppEvent,
  WhatsAppEventError,
  WhatsAppUser,
} from './types.js';

function header(headers: WebhookRequest['headers'], name: string): string | undefined {
  const key = Object.keys(headers ?? {}).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function queryValue(query: Record<string, unknown>, key: 'mode' | 'verify_token' | 'challenge'): string | undefined {
  const flat = query?.[`hub.${key}`];
  const nested = (query?.hub as Record<string, unknown> | undefined)?.[key];
  const value = flat ?? nested;
  return typeof value === 'string'
    ? value
    : Array.isArray(value) && typeof value[0] === 'string'
      ? value[0]
      : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Handles the `GET` request Meta sends when you save the webhook URL:
 * `hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. Returns the challenge to answer with.
 */
export function verifyChallenge(query: Record<string, unknown>, verifyToken: string | undefined): string {
  if (!verifyToken) throw new WhatsAppConfigurationError('whatsapp: verifyToken is not configured');
  const mode = queryValue(query, 'mode');
  const token = queryValue(query, 'verify_token');
  const challenge = queryValue(query, 'challenge');
  if (mode !== 'subscribe' || token === undefined || !safeEqual(token, verifyToken) || !challenge) {
    throw new WhatsAppWebhookError('verification token mismatch');
  }
  return challenge;
}

/** Verifies `X-Hub-Signature-256: sha256=HMAC-SHA256(appSecret, rawBody)`. */
export function verifySignature(request: WebhookRequest, appSecret: string | undefined): void {
  if (!appSecret) throw new WhatsAppConfigurationError('whatsapp: appSecret is required to verify webhooks');
  const signature = header(request.headers, 'x-hub-signature-256');
  if (!signature) throw new WhatsAppWebhookError('missing X-Hub-Signature-256 header');
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature.trim());
  if (!match) throw new WhatsAppWebhookError('malformed X-Hub-Signature-256 header');

  // Hash the bytes exactly as received: re-serialized JSON changes escaping and breaks the signature.
  const body = typeof request.rawBody === 'string' ? Buffer.from(request.rawBody, 'utf8') : request.rawBody;
  if (!Buffer.isBuffer(body)) throw new WhatsAppWebhookError('raw body is required');
  const expected = createHmac('sha256', appSecret).update(body).digest('hex');
  if (!safeEqual(expected, match[1].toLowerCase())) {
    throw new WhatsAppWebhookError('signature mismatch (is the raw body intact and the app secret correct?)');
  }
}

const toDate = (seconds: unknown): Date | undefined => {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000) : undefined;
};

const clean = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

function errors(list: unknown): WhatsAppEventError[] | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  return list.map((error: Record<string, any>) =>
    clean({ code: Number(error.code), title: error.title, message: error.message, details: error.error_data?.details }),
  );
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

function messageEvent(
  message: Record<string, any>,
  value: Record<string, any>,
  base: Record<string, any>,
): MessageEvent {
  const contacts: Array<Record<string, any>> = value.contacts ?? [];
  const contact =
    contacts.find(
      (c) => (message.from && c.wa_id === message.from) || (message.from_user_id && c.user_id === message.from_user_id),
    ) ?? (contacts.length === 1 ? contacts[0] : undefined);

  const from: WhatsAppUser = clean({
    phone: message.from ?? contact?.wa_id,
    userId: message.from_user_id ?? contact?.user_id,
    parentUserId: message.from_parent_user_id ?? contact?.parent_user_id,
    name: contact?.profile?.name,
    username: contact?.profile?.username,
  });

  const type: string = message.type ?? 'unsupported';
  const event: MessageEvent = {
    ...(base as Pick<MessageEvent, 'businessAccountId' | 'phoneNumberId' | 'displayPhoneNumber'>),
    kind: 'message',
    id: message.id,
    from,
    type,
    timestamp: toDate(message.timestamp),
    raw: message,
  };

  if (type === 'text') event.text = message.text?.body;

  if (MEDIA_TYPES.has(type) && message[type]) {
    const content = message[type];
    event.media = clean<IncomingMedia>({
      id: content.id,
      mimeType: content.mime_type,
      sha256: content.sha256,
      caption: content.caption,
      filename: content.filename,
      voice: content.voice,
      animated: content.animated,
    });
    event.text = content.caption;
  }

  if (type === 'interactive') {
    const interactive = message.interactive ?? {};
    const choice = interactive.button_reply ?? interactive.list_reply;
    if (choice) {
      event.reply = clean({ id: choice.id, title: choice.title, description: choice.description });
      event.text = choice.title;
    } else if (interactive.nfm_reply) {
      // WhatsApp Flows response: `response_json` holds the submitted form.
      const { name, body, response_json: responseJson } = interactive.nfm_reply;
      let response: Record<string, unknown>;
      try {
        response = typeof responseJson === 'string' ? JSON.parse(responseJson) : (responseJson ?? {});
      } catch {
        response = { raw: responseJson };
      }
      event.flow = clean({ name, response });
      event.text = body;
    }
  }

  if (type === 'button' && message.button) {
    // Quick reply button of a template.
    event.reply = { id: message.button.payload, title: message.button.text };
    event.text = message.button.text;
  }

  if (type === 'location' && message.location) {
    const { latitude, longitude, name, address, url } = message.location;
    event.location = clean({ latitude: Number(latitude), longitude: Number(longitude), name, address, url });
  }

  if (type === 'reaction' && message.reaction) {
    event.reaction = clean({ messageId: message.reaction.message_id, emoji: message.reaction.emoji || undefined });
  }

  if (message.context) {
    event.context = clean({
      messageId: message.context.id,
      from: message.context.from,
      forwarded: message.context.forwarded,
      frequentlyForwarded: message.context.frequently_forwarded,
    });
  }
  if (message.referral) event.referral = message.referral;
  const messageErrors = errors(message.errors);
  if (messageErrors) event.errors = messageErrors;
  return event;
}

function statusEvent(status: Record<string, any>, value: Record<string, any>, base: Record<string, any>): StatusEvent {
  const contact = (value.contacts ?? []).find(
    (c: Record<string, any>) =>
      (status.recipient_id && c.wa_id === status.recipient_id) ||
      (status.recipient_user_id && c.user_id === status.recipient_user_id),
  );
  const conversation = status.conversation;
  const pricing = status.pricing;
  return clean<StatusEvent>({
    ...(base as Pick<StatusEvent, 'businessAccountId' | 'phoneNumberId' | 'displayPhoneNumber'>),
    kind: 'status',
    messageId: status.id,
    status: status.status,
    recipient: clean({
      phone: status.recipient_id ?? contact?.wa_id,
      userId: status.recipient_user_id ?? contact?.user_id,
      parentUserId: status.recipient_parent_user_id ?? contact?.parent_user_id,
      name: contact?.profile?.name,
      username: contact?.profile?.username,
    }),
    timestamp: toDate(status.timestamp),
    conversation: conversation
      ? clean({
          id: conversation.id,
          originType: conversation.origin?.type,
          expiresAt: toDate(conversation.expiration_timestamp),
        })
      : undefined,
    pricing: pricing
      ? clean({
          category: pricing.category,
          model: pricing.pricing_model,
          type: pricing.type,
          billable: pricing.billable,
        })
      : undefined,
    callbackData: status.biz_opaque_callback_data,
    errors: errors(status.errors),
    raw: status,
  });
}

/**
 * Normalizes an already-verified webhook body. Prefer `WhatsAppClient.parseWebhook`, which checks the signature first.
 */
export function parseWebhookPayload(body: Buffer | string | Record<string, unknown>): WhatsAppEvent[] {
  let payload: Record<string, any>;
  try {
    payload = Buffer.isBuffer(body) || typeof body === 'string' ? JSON.parse(body.toString()) : body;
  } catch {
    throw new WhatsAppWebhookError('body is not valid JSON');
  }
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    throw new WhatsAppWebhookError('not a WhatsApp Business Account webhook');
  }

  const events: WhatsAppEvent[] = [];
  for (const entry of payload.entry) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const base = clean({
        businessAccountId: String(entry.id),
        phoneNumberId: value.metadata?.phone_number_id,
        displayPhoneNumber: value.metadata?.display_phone_number,
      });

      if (change.field === 'messages' && (value.messages || value.statuses)) {
        for (const message of value.messages ?? []) events.push(messageEvent(message, value, base));
        for (const status of value.statuses ?? []) events.push(statusEvent(status, value, base));
      } else if (change.field === 'message_template_status_update') {
        events.push(
          clean({
            ...base,
            kind: 'template_status' as const,
            event: value.event,
            templateId: String(value.message_template_id),
            templateName: value.message_template_name,
            language: value.message_template_language,
            reason: value.reason && value.reason !== 'NONE' ? value.reason : undefined,
            raw: value,
          }),
        );
      } else {
        events.push({ ...base, kind: 'other', field: String(change?.field), value, raw: change });
      }
    }
  }
  return events;
}
