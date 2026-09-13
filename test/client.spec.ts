import { describe, expect, it } from 'vitest';
import {
  WHATSAPP_ERROR_CODES,
  WhatsAppApiError,
  WhatsAppClient,
  WhatsAppConfigurationError,
  WhatsAppValidationError,
  type WhatsAppConfig,
} from '../src/core/index.js';
import { mockFetch, type MockRoute } from './helpers/mock-fetch.js';

const GRAPH = 'https://graph.facebook.com/v26.0';

function client(routes: MockRoute[] = [], config: Partial<WhatsAppConfig> = {}) {
  const mock = mockFetch(routes);
  return {
    whatsapp: new WhatsAppClient({
      accessToken: 'EAAG-token',
      phoneNumberId: '106540352242922',
      businessAccountId: '102290129340398',
      fetch: mock.fetch,
      ...config,
    }),
    calls: mock.calls,
  };
}

const sent = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '+573001234567', wa_id: '573001234567' }],
  messages: [{ id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBJDQjZCMzlEQUE4OTJBMTE4RTUA', message_status: 'accepted' }],
};

describe('WhatsAppClient', () => {
  it('validates configuration', () => {
    expect(() => new WhatsAppClient({ accessToken: '', phoneNumberId: '1' })).toThrow(WhatsAppConfigurationError);
    expect(() => new WhatsAppClient({ accessToken: 't', phoneNumberId: '' })).toThrow('phoneNumberId is required');
    expect(() => new WhatsAppClient({ accessToken: 't', phoneNumberId: '1', apiVersion: '26' })).toThrow('apiVersion');
    expect(new WhatsAppClient({ accessToken: 't', phoneNumberId: '1' })).toMatchObject({
      apiVersion: 'v26.0',
      phoneNumberId: '1',
    });
  });

  it('sends messages to the phone number endpoint with the access token', async () => {
    const { whatsapp, calls } = client([{ method: 'POST', url: `${GRAPH}/106540352242922/messages`, body: sent }]);
    const result = await whatsapp.sendText('+573001234567', 'Tu pedido fue enviado 📦');
    expect(result).toEqual({
      id: sent.messages[0].id,
      status: 'accepted',
      recipient: { input: '+573001234567', phone: '573001234567', userId: undefined },
      raw: sent,
    });
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer EAAG-token', 'Content-Type': 'application/json' });
    expect(calls[0].json()).toMatchObject({
      to: '+573001234567',
      type: 'text',
      text: { body: 'Tu pedido fue enviado 📦' },
    });
  });

  it('supports another sender, api version and base URL', async () => {
    const { whatsapp, calls } = client(
      [
        {
          method: 'POST',
          url: 'https://proxy.test/v25.0/999/messages',
          body: { messages: [{ id: 'wamid.2' }], contacts: [{ input: 'CO.123', user_id: 'CO.123' }] },
        },
      ],
      { apiVersion: 'v25.0', baseUrl: 'https://proxy.test/' },
    );
    const result = await whatsapp.sendImage('CO.123', { id: 'media-1' }, { phoneNumberId: '999', caption: 'Hola' });
    expect(result.recipient).toEqual({ input: 'CO.123', phone: undefined, userId: 'CO.123' });
    expect(calls[0].json()).toMatchObject({ recipient: 'CO.123', image: { id: 'media-1', caption: 'Hola' } });
  });

  it('exposes a helper for every message type', async () => {
    const { whatsapp, calls } = client([{ method: 'POST', url: `${GRAPH}/106540352242922/messages`, body: sent }]);
    const to = '+573001234567';
    await whatsapp.sendTemplate(to, { name: 'hello_world', language: 'en_US' });
    await whatsapp.sendAuthenticationCode(to, { name: 'otp', language: 'es' }, '123456');
    await whatsapp.sendDocument(to, { link: 'https://cdn.test/a.pdf' }, { filename: 'a.pdf' });
    await whatsapp.sendVideo(to, { id: 'v' });
    await whatsapp.sendAudio(to, { id: 'a' });
    await whatsapp.sendSticker(to, { id: 's' });
    await whatsapp.sendLocation(to, { latitude: 1, longitude: 2 });
    await whatsapp.sendReaction(to, 'wamid.1', '👍');
    await whatsapp.sendButtons(to, { body: 'b', buttons: [{ id: 'a', title: 'A' }] });
    await whatsapp.sendList(to, { body: 'b', button: 'Ver', sections: [{ rows: [{ id: 'r', title: 'R' }] }] });
    await whatsapp.sendCtaUrl(to, { body: 'b', displayText: 'Abrir', url: 'https://x.test' });
    await whatsapp.send({ messaging_product: 'whatsapp', to, type: 'contacts', contacts: [] });
    expect(calls.map((call) => call.json().type)).toEqual([
      'template',
      'template',
      'document',
      'video',
      'audio',
      'sticker',
      'location',
      'reaction',
      'interactive',
      'interactive',
      'interactive',
      'contacts',
    ]);
  });

  it('marks messages as read with an optional typing indicator', async () => {
    const { whatsapp, calls } = client([
      { method: 'POST', url: `${GRAPH}/106540352242922/messages`, body: { success: true } },
    ]);
    await whatsapp.markAsRead('wamid.in', { typing: true });
    await whatsapp.markAsRead('wamid.in2');
    expect(calls[0].json()).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.in',
      typing_indicator: { type: 'text' },
    });
    expect(calls[1].json()).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.in2' });
    await expect(whatsapp.markAsRead('')).rejects.toBeInstanceOf(WhatsAppValidationError);
  });

  it('uploads, reads, downloads and deletes media', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const { whatsapp, calls } = client([
      { method: 'POST', url: `${GRAPH}/106540352242922/media`, body: { id: '1037543291543636' } },
      {
        method: 'GET',
        url: `${GRAPH}/1037543291543636`,
        body: {
          id: '1037543291543636',
          url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1037543291543636',
          mime_type: 'application/pdf',
          sha256: 'abc',
          file_size: '4',
        },
      },
      { method: 'GET', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/', raw: bytes },
      { method: 'DELETE', url: `${GRAPH}/1037543291543636`, body: { success: true } },
    ]);

    expect(await whatsapp.uploadMedia(bytes, 'application/pdf', { filename: 'factura.pdf' })).toBe('1037543291543636');
    const form = calls[0].rawBody as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('application/pdf');
    expect((form.get('file') as File).name).toBe('factura.pdf');
    expect(calls[0].headers['Content-Type']).toBeUndefined();

    const media = await whatsapp.downloadMedia('1037543291543636');
    expect(media).toMatchObject({ id: '1037543291543636', mimeType: 'application/pdf', fileSize: 4 });
    expect([...media.data]).toEqual([...bytes]);
    expect(calls[2].headers.Authorization).toBe('Bearer EAAG-token');

    await whatsapp.deleteMedia('1037543291543636');
    expect(calls[3].method).toBe('DELETE');

    await expect(whatsapp.uploadMedia(new Blob(['x']), '')).rejects.toThrow('mimeType is required');
  });

  it('reports failed media downloads', async () => {
    const { whatsapp } = client([
      {
        method: 'GET',
        url: `${GRAPH}/m1`,
        body: { id: 'm1', url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/png', sha256: 's', file_size: 1 },
      },
      { method: 'GET', url: 'https://lookaside.fbsbx.com/x', raw: 'gone', status: 404 },
    ]);
    await expect(whatsapp.downloadMedia('m1')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it('manages templates on the business account', async () => {
    const { whatsapp, calls } = client([
      {
        method: 'GET',
        url: `${GRAPH}/102290129340398/message_templates`,
        body: {
          data: [
            {
              id: '1',
              name: 'order_shipped',
              language: 'es',
              status: 'APPROVED',
              category: 'UTILITY',
              components: [{ type: 'BODY' }],
            },
          ],
          paging: { cursors: { before: 'b', after: 'next-page' }, next: 'https://graph.facebook.com/…' },
        },
      },
      {
        method: 'POST',
        url: `${GRAPH}/102290129340398/message_templates`,
        body: { id: '2', status: 'PENDING', category: 'UTILITY' },
      },
      { method: 'DELETE', url: `${GRAPH}/102290129340398/message_templates`, body: { success: true } },
    ]);
    const list = await whatsapp.listTemplates({ status: 'APPROVED', limit: 50 });
    expect(list).toMatchObject({
      nextCursor: 'next-page',
      templates: [{ id: '1', name: 'order_shipped', language: 'es', status: 'APPROVED', category: 'UTILITY' }],
    });
    expect(calls[0].url.searchParams.get('status')).toBe('APPROVED');
    expect(calls[0].url.searchParams.get('limit')).toBe('50');
    expect(calls[0].url.searchParams.has('name')).toBe(false);

    const created = await whatsapp.createTemplate({
      name: 'order_shipped',
      language: 'es',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Tu pedido {{1}} fue enviado' }],
    });
    expect(created).toEqual({ id: '2', status: 'PENDING', category: 'UTILITY' });

    await whatsapp.deleteTemplate('order_shipped', { templateId: '1' });
    expect(Object.fromEntries(calls[2].url.searchParams)).toEqual({ name: 'order_shipped', hsm_id: '1' });

    await expect(
      whatsapp.createTemplate({ name: 'Order Shipped', language: 'es', category: 'UTILITY', components: [] }),
    ).rejects.toThrow('lowercase');
    const noWaba = client([], { businessAccountId: undefined });
    await expect(noWaba.whatsapp.listTemplates()).rejects.toThrow('businessAccountId is required');
  });

  it('turns Graph errors into WhatsAppApiError', async () => {
    const { whatsapp } = client([
      {
        method: 'POST',
        url: `${GRAPH}/106540352242922/messages`,
        status: 400,
        body: {
          error: {
            message: '(#131047) Re-engagement message',
            type: 'OAuthException',
            code: 131047,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'Message failed to send because more than 24 hours have passed',
            },
            fbtrace_id: 'Az8or2yhqkZfEZ-_4Qn_Bam',
          },
        },
      },
    ]);
    const error = await whatsapp.sendText('+573001234567', 'hola').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect(error).toMatchObject({
      message: '(#131047) Re-engagement message (#131047)',
      httpStatus: 400,
      code: WHATSAPP_ERROR_CODES.CUSTOMER_SERVICE_WINDOW_EXPIRED,
      details: 'Message failed to send because more than 24 hours have passed',
      fbtraceId: 'Az8or2yhqkZfEZ-_4Qn_Bam',
      isOutsideCustomerServiceWindow: true,
      isRateLimited: false,
      isAuthError: false,
    });
  });

  it('classifies rate limit, auth, non-JSON and network errors', async () => {
    const { whatsapp } = client([
      {
        method: 'POST',
        url: `${GRAPH}/1/messages`,
        status: 400,
        body: { error: { message: 'Rate limit hit', code: 130429 } },
      },
      {
        method: 'POST',
        url: `${GRAPH}/2/messages`,
        status: 401,
        body: { error: { message: 'Session expired', code: 190, error_subcode: 463 } },
      },
      { method: 'POST', url: `${GRAPH}/3/messages`, status: 502, raw: '<html>Bad gateway</html>' },
      { method: 'POST', url: `${GRAPH}/4/messages`, networkError: true },
    ]);
    const send = (phoneNumberId: string) =>
      whatsapp.sendText('+573001234567', 'x', { phoneNumberId }).catch((e: WhatsAppApiError) => e);
    expect(await send('1')).toMatchObject({ isRateLimited: true });
    expect(await send('2')).toMatchObject({ isAuthError: true, subcode: 463, httpStatus: 401 });
    expect(await send('3')).toMatchObject({ httpStatus: 502, message: 'POST /v26.0/3/messages failed with HTTP 502' });
    const network = (await send('4')) as WhatsAppApiError;
    expect(network).toBeInstanceOf(WhatsAppApiError);
    expect(network.message).toBe('network error calling /v26.0/4/messages');
  });
});
