import { createHmac } from 'node:crypto';

export const APP_SECRET = 'app-secret-123';
export const VERIFY_TOKEN = 'my-verify-token';
export const WABA_ID = '102290129340398';

const metadata = { display_phone_number: '15550783881', phone_number_id: '106540352242922' };

/** Wraps `value` in the envelope Meta posts to the webhook. */
export function webhookBody(value: Record<string, unknown>, field = 'messages') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA_ID,
        changes: [
          { field, value: field === 'messages' ? { messaging_product: 'whatsapp', metadata, ...value } : value },
        ],
      },
    ],
  };
}

export function signed(body: unknown, secret = APP_SECRET) {
  const rawBody = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    rawBody,
    headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}` },
  };
}

export const textMessageValue = {
  contacts: [{ profile: { name: 'Ana López' }, wa_id: '573001234567', user_id: 'CO.13491208655302741918' }],
  messages: [
    {
      from: '573001234567',
      from_user_id: 'CO.13491208655302741918',
      id: 'wamid.HBgMNTczMDAxMjM0NTY3FQIAEhgUM0EwRkY',
      timestamp: '1757764800',
      type: 'text',
      text: { body: 'Hola' },
    },
  ],
};

export const sentStatusValue = {
  contacts: [{ wa_id: '573001234567', user_id: 'CO.13491208655302741918' }],
  statuses: [
    {
      id: 'wamid.OUT1',
      status: 'sent',
      timestamp: '1757764900',
      recipient_id: '573001234567',
      recipient_user_id: 'CO.13491208655302741918',
      biz_opaque_callback_data: 'order-9',
      conversation: { id: 'CONVERSATION_ID', expiration_timestamp: '1757851300', origin: { type: 'utility' } },
      pricing: { billable: true, pricing_model: 'PMP', category: 'utility', type: 'regular' },
    },
  ],
};
