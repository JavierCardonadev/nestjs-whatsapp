import { describe, expect, it } from 'vitest';
import {
  parseWebhookPayload,
  verifyChallenge,
  verifySignature,
  WhatsAppClient,
  WhatsAppConfigurationError,
  WhatsAppWebhookError,
  type MessageEvent,
  type StatusEvent,
} from '../src/core/index.js';
import {
  APP_SECRET,
  sentStatusValue,
  signed,
  textMessageValue,
  VERIFY_TOKEN,
  WABA_ID,
  webhookBody,
} from './helpers/fixtures.js';

const single = <T>(value: Record<string, unknown>, field?: string) =>
  parseWebhookPayload(webhookBody(value, field))[0] as T;

function message(content: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return single<MessageEvent>({
    contacts: [{ profile: { name: 'Ana' }, wa_id: '573001234567' }],
    messages: [{ from: '573001234567', id: 'wamid.1', timestamp: '1757764800', ...content }],
    ...extra,
  });
}

describe('webhook verification', () => {
  it('answers the subscription challenge', () => {
    expect(
      verifyChallenge(
        { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' },
        VERIFY_TOKEN,
      ),
    ).toBe('1158201444');
    expect(
      verifyChallenge({ hub: { mode: 'subscribe', verify_token: VERIFY_TOKEN, challenge: ['42'] } }, VERIFY_TOKEN),
    ).toBe('42');
  });

  it('rejects bad challenges', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' };
    expect(() => verifyChallenge(query, VERIFY_TOKEN)).toThrow(WhatsAppWebhookError);
    expect(() =>
      verifyChallenge({ ...query, 'hub.verify_token': VERIFY_TOKEN, 'hub.mode': 'unsubscribe' }, VERIFY_TOKEN),
    ).toThrow('verification token mismatch');
    expect(() => verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN }, VERIFY_TOKEN)).toThrow(
      WhatsAppWebhookError,
    );
    expect(() => verifyChallenge(query, undefined)).toThrow(WhatsAppConfigurationError);
  });

  it('verifies X-Hub-Signature-256 over the raw bytes', () => {
    // Meta escapes non-ASCII characters; the signature only matches the bytes as received.
    const raw = '{"object":"whatsapp_business_account","entry":[],"note":"\\u00e1"}';
    const request = signed(raw);
    expect(() => verifySignature(request, APP_SECRET)).not.toThrow();
    expect(() => verifySignature({ ...request, rawBody: raw }, APP_SECRET)).not.toThrow();
    expect(() => verifySignature({ ...request, rawBody: JSON.stringify(JSON.parse(raw)) }, APP_SECRET)).toThrow(
      'signature mismatch',
    );
    expect(() =>
      verifySignature(
        { rawBody: request.rawBody, headers: { 'X-Hub-Signature-256': [request.headers['x-hub-signature-256']] } },
        APP_SECRET,
      ),
    ).not.toThrow();
  });

  it('rejects missing, malformed and forged signatures', () => {
    const request = signed({ object: 'whatsapp_business_account', entry: [] });
    expect(() => verifySignature({ ...request, headers: {} }, APP_SECRET)).toThrow('missing X-Hub-Signature-256');
    expect(() => verifySignature({ ...request, headers: { 'x-hub-signature-256': 'sha1=abc' } }, APP_SECRET)).toThrow(
      'malformed',
    );
    expect(() => verifySignature(request, 'other-secret')).toThrow('signature mismatch');
    expect(() => verifySignature({ ...request, rawBody: undefined as unknown as Buffer }, APP_SECRET)).toThrow(
      'raw body is required',
    );
    expect(() => verifySignature(request, undefined)).toThrow(WhatsAppConfigurationError);
  });

  it('WhatsAppClient.parseWebhook verifies before parsing', () => {
    const client = new WhatsAppClient({ accessToken: 't', phoneNumberId: '1', appSecret: APP_SECRET });
    expect(client.parseWebhook(signed(webhookBody(textMessageValue)))).toHaveLength(1);
    expect(() => client.parseWebhook(signed(webhookBody(textMessageValue), 'forged'))).toThrow(WhatsAppWebhookError);
  });

  it('rejects payloads that are not WhatsApp webhooks', () => {
    expect(() => parseWebhookPayload('{not json')).toThrow('not valid JSON');
    expect(() => parseWebhookPayload({ object: 'page', entry: [] })).toThrow('not a WhatsApp Business Account webhook');
  });
});

describe('parseWebhookPayload', () => {
  it('normalizes text messages with phone and BSUID', () => {
    const [event] = parseWebhookPayload(Buffer.from(JSON.stringify(webhookBody(textMessageValue))));
    expect(event).toEqual({
      kind: 'message',
      businessAccountId: WABA_ID,
      phoneNumberId: '106540352242922',
      displayPhoneNumber: '15550783881',
      id: 'wamid.HBgMNTczMDAxMjM0NTY3FQIAEhgUM0EwRkY',
      from: { phone: '573001234567', userId: 'CO.13491208655302741918', name: 'Ana López' },
      type: 'text',
      text: 'Hola',
      timestamp: new Date(1_757_764_800_000),
      raw: textMessageValue.messages[0],
    });
  });

  it('handles users with a username and no phone number', () => {
    const event = single<MessageEvent>({
      contacts: [{ profile: { name: 'Ana', username: '@ana.store' }, user_id: 'CO.555', parent_user_id: 'CO.ENT.777' }],
      messages: [
        { from_user_id: 'CO.555', id: 'wamid.2', timestamp: '1757764800', type: 'text', text: { body: 'hi' } },
      ],
    });
    expect(event.from).toEqual({ userId: 'CO.555', parentUserId: 'CO.ENT.777', name: 'Ana', username: '@ana.store' });
  });

  it('normalizes media with captions and voice notes', () => {
    expect(
      message({ type: 'image', image: { id: 'img-1', mime_type: 'image/jpeg', sha256: 'h', caption: 'Mi pedido' } }),
    ).toMatchObject({
      type: 'image',
      text: 'Mi pedido',
      media: { id: 'img-1', mimeType: 'image/jpeg', sha256: 'h', caption: 'Mi pedido' },
    });
    expect(
      message({ type: 'audio', audio: { id: 'a-1', mime_type: 'audio/ogg; codecs=opus', voice: true } }).media,
    ).toEqual({
      id: 'a-1',
      mimeType: 'audio/ogg; codecs=opus',
      voice: true,
    });
    expect(message({ type: 'document', document: { id: 'd', filename: 'rut.pdf' } }).media).toMatchObject({
      filename: 'rut.pdf',
    });
  });

  it('normalizes button, list and template replies', () => {
    expect(
      message({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Sí' } },
        context: { from: '15550783881', id: 'wamid.out' },
      }),
    ).toMatchObject({
      text: 'Sí',
      reply: { id: 'yes', title: 'Sí' },
      context: { messageId: 'wamid.out', from: '15550783881' },
    });
    expect(
      message({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'track', title: 'Rastrear', description: 'Estado' } },
      }),
    ).toMatchObject({ text: 'Rastrear', reply: { id: 'track', title: 'Rastrear', description: 'Estado' } });
    expect(message({ type: 'button', button: { payload: 'STOP_PROMOS', text: 'Dejar de recibir' } })).toMatchObject({
      text: 'Dejar de recibir',
      reply: { id: 'STOP_PROMOS', title: 'Dejar de recibir' },
    });
    const flow = message({
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: { name: 'flow', body: 'Sent', response_json: '{"flow_token":"t1","plan":"pro"}' },
      },
    });
    expect(flow).toMatchObject({ text: 'Sent', flow: { name: 'flow', response: { flow_token: 't1', plan: 'pro' } } });
    expect(flow).not.toHaveProperty('reply');
    expect(
      message({
        type: 'interactive',
        interactive: { type: 'nfm_reply', nfm_reply: { body: 'Sent', response_json: '{oops' } },
      }).flow,
    ).toEqual({ response: { raw: '{oops' } });
  });

  it('normalizes locations, reactions, forwards, referrals and errors', () => {
    expect(
      message({ type: 'location', location: { latitude: '4.711', longitude: -74.07, name: 'Oficina' } }).location,
    ).toEqual({
      latitude: 4.711,
      longitude: -74.07,
      name: 'Oficina',
    });
    expect(message({ type: 'reaction', reaction: { message_id: 'wamid.out', emoji: '❤️' } }).reaction).toEqual({
      messageId: 'wamid.out',
      emoji: '❤️',
    });
    expect(message({ type: 'reaction', reaction: { message_id: 'wamid.out', emoji: '' } }).reaction).toEqual({
      messageId: 'wamid.out',
    });
    expect(
      message({ type: 'text', text: { body: 'fw' }, context: { forwarded: true, frequently_forwarded: true } }).context,
    ).toEqual({
      forwarded: true,
      frequentlyForwarded: true,
    });
    expect(
      message({ type: 'text', text: { body: 'ad' }, referral: { source_type: 'ad', ctwa_clid: 'x' } }).referral,
    ).toEqual({
      source_type: 'ad',
      ctwa_clid: 'x',
    });
    expect(
      message({
        type: 'unsupported',
        errors: [
          {
            code: 131051,
            title: 'Message type unknown',
            error_data: { details: 'Message type is currently not supported.' },
          },
        ],
      }),
    ).toMatchObject({
      type: 'unsupported',
      errors: [{ code: 131051, title: 'Message type unknown', details: 'Message type is currently not supported.' }],
    });
  });

  it('normalizes sent statuses with conversation and pricing', () => {
    expect(single<StatusEvent>(sentStatusValue)).toEqual({
      kind: 'status',
      businessAccountId: WABA_ID,
      phoneNumberId: '106540352242922',
      displayPhoneNumber: '15550783881',
      messageId: 'wamid.OUT1',
      status: 'sent',
      recipient: { phone: '573001234567', userId: 'CO.13491208655302741918' },
      timestamp: new Date(1_757_764_900_000),
      conversation: { id: 'CONVERSATION_ID', originType: 'utility', expiresAt: new Date(1_757_851_300_000) },
      pricing: { category: 'utility', model: 'PMP', type: 'regular', billable: true },
      callbackData: 'order-9',
      raw: sentStatusValue.statuses[0],
    });
  });

  it('normalizes read and failed statuses', () => {
    const read = single<StatusEvent>({
      contacts: [{ profile: { username: '@ana' }, user_id: 'CO.1' }],
      statuses: [{ id: 'wamid.OUT1', status: 'read', timestamp: '1757765000', recipient_user_id: 'CO.1' }],
    });
    expect(read).toMatchObject({ status: 'read', recipient: { userId: 'CO.1', username: '@ana' } });
    expect(read.pricing).toBeUndefined();
    expect(read.conversation).toBeUndefined();

    const failed = single<StatusEvent>({
      statuses: [
        {
          id: 'wamid.OUT2',
          status: 'failed',
          timestamp: '1757765000',
          recipient_id: '573001234567',
          errors: [
            {
              code: 131026,
              title: 'Message undeliverable',
              message: 'Message undeliverable',
              error_data: { details: 'Unable to deliver' },
            },
          ],
        },
      ],
    });
    expect(failed).toMatchObject({
      status: 'failed',
      recipient: { phone: '573001234567' },
      errors: [
        {
          code: 131026,
          title: 'Message undeliverable',
          message: 'Message undeliverable',
          details: 'Unable to deliver',
        },
      ],
    });
  });

  it('normalizes template status updates and passes other fields through', () => {
    const template = parseWebhookPayload(
      webhookBody(
        {
          event: 'REJECTED',
          message_template_id: 594425479261596,
          message_template_name: 'promo',
          message_template_language: 'es',
          reason: 'INCORRECT_CATEGORY',
        },
        'message_template_status_update',
      ),
    );
    expect(template).toEqual([
      {
        kind: 'template_status',
        businessAccountId: WABA_ID,
        event: 'REJECTED',
        templateId: '594425479261596',
        templateName: 'promo',
        language: 'es',
        reason: 'INCORRECT_CATEGORY',
        raw: expect.any(Object),
      },
    ]);
    const approved = parseWebhookPayload(
      webhookBody(
        { event: 'APPROVED', message_template_id: 1, message_template_name: 'x', reason: 'NONE' },
        'message_template_status_update',
      ),
    )[0];
    expect(approved).not.toHaveProperty('reason');

    const other = parseWebhookPayload(webhookBody({ event: 'VERIFIED_ACCOUNT' }, 'account_update'))[0];
    expect(other).toMatchObject({ kind: 'other', field: 'account_update', value: { event: 'VERIFIED_ACCOUNT' } });
  });

  it('emits one event per message and status, in order', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: { ...textMessageValue, ...sentStatusValue, contacts: textMessageValue.contacts },
            },
          ],
        },
        { id: 'OTHER_WABA', changes: [{ field: 'messages', value: textMessageValue }] },
      ],
    };
    expect(parseWebhookPayload(body).map((event) => [event.kind, event.businessAccountId])).toEqual([
      ['message', WABA_ID],
      ['status', WABA_ID],
      ['message', 'OTHER_WABA'],
    ]);
  });
});
