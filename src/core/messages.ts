import { WhatsAppValidationError } from './errors.js';
import type {
  CtaUrlMessage,
  InteractiveHeader,
  ListMessage,
  Location,
  MediaOptions,
  MediaSource,
  MediaType,
  Recipient,
  ReplyButtonsMessage,
  SendOptions,
  TemplateMessage,
  TemplateParameter,
} from './types.js';

export type MessagePayload = Record<string, unknown>;

// Business-scoped user id: country code, optional `ENT.` (parent id), alphanumeric id.
const BSUID = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/;

export function isBusinessScopedUserId(value: string): boolean {
  return BSUID.test(value);
}

function fail(message: string): never {
  throw new WhatsAppValidationError(message);
}

function assertText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} is required`);
  if (value.length > max) fail(`${field} must be at most ${max} characters (got ${value.length})`);
  return value;
}

/** `to` for phone numbers, `recipient` for business-scoped user ids. */
export function recipientFields(recipient: Recipient): MessagePayload {
  if (typeof recipient !== 'string' || recipient.trim() === '') fail('recipient is required');
  const value = recipient.trim();
  if (isBusinessScopedUserId(value)) return { recipient: value };

  const phone = value.replace(/[\s().-]/g, '');
  if (!/^\+?\d{7,15}$/.test(phone)) {
    fail(`recipient must be an E.164 phone number or a business-scoped user id; received "${recipient}"`);
  }
  return { to: phone };
}

function envelope(recipient: Recipient, type: string, content: unknown, options: SendOptions = {}): MessagePayload {
  if (options.callbackData !== undefined && options.callbackData.length > 512) {
    fail('callbackData must be at most 512 characters');
  }
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...recipientFields(recipient),
    ...(options.replyTo ? { context: { message_id: options.replyTo } } : {}),
    ...(options.callbackData !== undefined ? { biz_opaque_callback_data: options.callbackData } : {}),
    type,
    [type]: content,
  };
}

function media(source: MediaSource): { id: string } | { link: string } {
  if (source && 'id' in source && source.id) return { id: source.id };
  if (source && 'link' in source && source.link) {
    if (!/^https?:\/\//i.test(source.link)) fail('media link must be an http(s) URL');
    return { link: source.link };
  }
  return fail('media requires an `id` (uploaded) or a `link`');
}

export function textMessage(to: Recipient, body: string, options: SendOptions & { previewUrl?: boolean } = {}) {
  return envelope(
    to,
    'text',
    { body: assertText(body, 'text', 4096), preview_url: options.previewUrl ?? false },
    options,
  );
}

export function mediaMessage(to: Recipient, type: MediaType, source: MediaSource, options: MediaOptions = {}) {
  const content: Record<string, unknown> = media(source);
  if (options.caption !== undefined) {
    if (type === 'audio' || type === 'sticker') fail(`${type} messages can't have a caption`);
    content.caption = assertText(options.caption, 'caption', 1024);
  }
  if (options.filename !== undefined) {
    if (type !== 'document') fail('filename is only supported for documents');
    content.filename = options.filename;
  }
  return envelope(to, type, content, options);
}

export function locationMessage(to: Recipient, location: Location, options: SendOptions = {}) {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) fail('latitude must be between -90 and 90');
  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) fail('longitude must be between -180 and 180');
  return envelope(to, 'location', { latitude, longitude, name: location.name, address: location.address }, options);
}

/** Pass an empty `emoji` to remove a reaction. */
export function reactionMessage(to: Recipient, messageId: string, emoji: string, options: SendOptions = {}) {
  return envelope(to, 'reaction', { message_id: assertText(messageId, 'messageId', 1024), emoji }, options);
}

function textParameter(value: TemplateParameter, name?: string): Record<string, unknown> {
  if (typeof value === 'string' || typeof value === 'number') {
    return { type: 'text', text: String(value), ...(name ? { parameter_name: name } : {}) };
  }
  return value as Record<string, unknown>;
}

export function templateMessage(to: Recipient, template: TemplateMessage, options: SendOptions = {}) {
  assertText(template.name, 'template name', 512);
  assertText(template.language, 'template language', 16);
  const components: Array<Record<string, unknown>> = [];

  const header = template.header;
  if (header) {
    let parameter: Record<string, unknown>;
    if (header.type === 'text') {
      parameter = {
        type: 'text',
        text: header.text,
        ...(header.parameterName ? { parameter_name: header.parameterName } : {}),
      };
    } else if (header.type === 'location') {
      parameter = { type: 'location', location: header.location };
    } else {
      const source: Record<string, unknown> = media(header.media);
      if (header.type === 'document' && header.filename) source.filename = header.filename;
      parameter = { type: header.type, [header.type]: source };
    }
    components.push({ type: 'header', parameters: [parameter] });
  }

  if (template.body) {
    const parameters = Array.isArray(template.body)
      ? template.body.map((value) => textParameter(value))
      : Object.entries(template.body).map(([name, value]) => textParameter(value, name));
    if (parameters.length > 0) components.push({ type: 'body', parameters });
  }

  template.buttons?.forEach((button, position) => {
    const index = String(button.index ?? position);
    switch (button.type) {
      case 'url':
        components.push({ type: 'button', sub_type: 'url', index, parameters: [{ type: 'text', text: button.text }] });
        break;
      case 'quick_reply':
        components.push({
          type: 'button',
          sub_type: 'quick_reply',
          index,
          parameters: [{ type: 'payload', payload: button.payload }],
        });
        break;
      case 'copy_code':
        components.push({
          type: 'button',
          sub_type: 'copy_code',
          index,
          parameters: [{ type: 'coupon_code', coupon_code: button.code }],
        });
        break;
      default:
        fail(`unsupported template button type "${(button as { type: string }).type}"`);
    }
  });

  components.push(...(template.components ?? []));

  return envelope(
    to,
    'template',
    {
      name: template.name,
      language: { code: template.language },
      ...(components.length > 0 ? { components } : {}),
    },
    options,
  );
}

/**
 * One-time passcode with an authentication template: the code fills the body and the copy-code/one-tap button.
 */
export function authenticationTemplateMessage(
  to: Recipient,
  template: { name: string; language: string },
  code: string,
  options: SendOptions = {},
) {
  assertText(code, 'code', 15);
  return templateMessage(
    to,
    {
      ...template,
      body: [code],
      components: [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] }],
    },
    options,
  );
}

function interactiveHeader(header: InteractiveHeader | undefined) {
  if (!header) return undefined;
  if (header.type === 'text') return { type: 'text', text: assertText(header.text, 'header text', 60) };
  return { type: header.type, [header.type]: media(header.media) };
}

function footer(text: string | undefined) {
  return text === undefined ? undefined : { text: assertText(text, 'footer', 60) };
}

export function buttonsMessage(to: Recipient, message: ReplyButtonsMessage, options: SendOptions = {}) {
  if (!Array.isArray(message.buttons) || message.buttons.length < 1 || message.buttons.length > 3) {
    fail('reply buttons messages need 1 to 3 buttons');
  }
  const ids = new Set<string>();
  const buttons = message.buttons.map((button) => {
    assertText(button.id, 'button id', 256);
    if (ids.has(button.id)) fail(`duplicate button id "${button.id}"`);
    ids.add(button.id);
    return { type: 'reply', reply: { id: button.id, title: assertText(button.title, 'button title', 20) } };
  });
  return envelope(
    to,
    'interactive',
    {
      type: 'button',
      header: interactiveHeader(message.header),
      body: { text: assertText(message.body, 'body', 1024) },
      footer: footer(message.footer),
      action: { buttons },
    },
    options,
  );
}

export function listMessage(to: Recipient, message: ListMessage, options: SendOptions = {}) {
  const sections = message.sections ?? [];
  const rows = sections.flatMap((section) => section.rows ?? []);
  if (sections.length < 1 || sections.length > 10) fail('list messages need 1 to 10 sections');
  if (rows.length < 1 || rows.length > 10) fail('list messages need 1 to 10 rows in total');
  if (sections.length > 1 && sections.some((section) => !section.title)) {
    fail('every section needs a title when there is more than one');
  }
  const ids = new Set<string>();
  return envelope(
    to,
    'interactive',
    {
      type: 'list',
      header: message.header ? { type: 'text', text: assertText(message.header.text, 'header text', 60) } : undefined,
      body: { text: assertText(message.body, 'body', 4096) },
      footer: footer(message.footer),
      action: {
        button: assertText(message.button, 'list button', 20),
        sections: sections.map((section) => ({
          title: section.title === undefined ? undefined : assertText(section.title, 'section title', 24),
          rows: section.rows.map((row) => {
            assertText(row.id, 'row id', 200);
            if (ids.has(row.id)) fail(`duplicate row id "${row.id}"`);
            ids.add(row.id);
            return {
              id: row.id,
              title: assertText(row.title, 'row title', 24),
              description:
                row.description === undefined ? undefined : assertText(row.description, 'row description', 72),
            };
          }),
        })),
      },
    },
    options,
  );
}

export function ctaUrlMessage(to: Recipient, message: CtaUrlMessage, options: SendOptions = {}) {
  if (!/^https?:\/\//i.test(message.url ?? '')) fail('url must be an http(s) URL');
  return envelope(
    to,
    'interactive',
    {
      type: 'cta_url',
      header: interactiveHeader(message.header),
      body: { text: assertText(message.body, 'body', 1024) },
      footer: footer(message.footer),
      action: {
        name: 'cta_url',
        parameters: { display_text: assertText(message.displayText, 'displayText', 20), url: message.url },
      },
    },
    options,
  );
}
