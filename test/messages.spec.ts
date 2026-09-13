import { describe, expect, it } from 'vitest';
import {
  authenticationTemplateMessage,
  buttonsMessage,
  ctaUrlMessage,
  isBusinessScopedUserId,
  listMessage,
  locationMessage,
  mediaMessage,
  reactionMessage,
  recipientFields,
  templateMessage,
  textMessage,
  WhatsAppValidationError,
} from '../src/core/index.js';

const base = { messaging_product: 'whatsapp', recipient_type: 'individual' };

describe('recipients', () => {
  it('sends phone numbers as `to`, stripping separators', () => {
    expect(recipientFields('+57 (300) 123-4567')).toEqual({ to: '+573001234567' });
    expect(recipientFields('5511912345678')).toEqual({ to: '5511912345678' });
  });

  it('sends business-scoped user ids as `recipient`', () => {
    expect(isBusinessScopedUserId('US.13491208655302741918')).toBe(true);
    expect(isBusinessScopedUserId('US.ENT.11815799212886844830')).toBe(true);
    expect(isBusinessScopedUserId('us.123')).toBe(false);
    expect(recipientFields(' CO.13491208655302741918 ')).toEqual({ recipient: 'CO.13491208655302741918' });
  });

  it('rejects anything else', () => {
    expect(() => recipientFields('')).toThrow('recipient is required');
    expect(() => recipientFields('call me')).toThrow(WhatsAppValidationError);
    expect(() => recipientFields('123')).toThrow('E.164');
  });
});

describe('message builders', () => {
  it('builds text messages with reply context and callback data', () => {
    expect(
      textMessage('+573001234567', 'Hola', { previewUrl: true, replyTo: 'wamid.1', callbackData: 'order-9' }),
    ).toEqual({
      ...base,
      to: '+573001234567',
      context: { message_id: 'wamid.1' },
      biz_opaque_callback_data: 'order-9',
      type: 'text',
      text: { body: 'Hola', preview_url: true },
    });
    expect(() => textMessage('+573001234567', ' ')).toThrow('text is required');
    expect(() => textMessage('+573001234567', 'x'.repeat(4097))).toThrow('at most 4096');
    expect(() => textMessage('+573001234567', 'x', { callbackData: 'x'.repeat(513) })).toThrow('callbackData');
  });

  it('builds media messages', () => {
    expect(
      mediaMessage(
        '+573001234567',
        'document',
        { link: 'https://cdn.test/f.pdf' },
        { caption: 'Factura', filename: 'f.pdf' },
      ),
    ).toMatchObject({
      type: 'document',
      document: { link: 'https://cdn.test/f.pdf', caption: 'Factura', filename: 'f.pdf' },
    });
    expect(mediaMessage('+573001234567', 'audio', { id: '123' })).toMatchObject({
      type: 'audio',
      audio: { id: '123' },
    });
    expect(() => mediaMessage('+573001234567', 'audio', { id: '1' }, { caption: 'no' })).toThrow(
      "can't have a caption",
    );
    expect(() => mediaMessage('+573001234567', 'image', { id: '1' }, { filename: 'a.png' })).toThrow(
      'only supported for documents',
    );
    expect(() => mediaMessage('+573001234567', 'image', { link: 'ftp://x' })).toThrow('http(s)');
    expect(() => mediaMessage('+573001234567', 'image', {} as { id: string })).toThrow('requires an `id`');
  });

  it('builds location and reaction messages', () => {
    expect(locationMessage('+573001234567', { latitude: 4.711, longitude: -74.0721, name: 'Bogotá' })).toMatchObject({
      location: { latitude: 4.711, longitude: -74.0721, name: 'Bogotá' },
    });
    expect(() => locationMessage('+573001234567', { latitude: 91, longitude: 0 })).toThrow('latitude');
    expect(() => locationMessage('+573001234567', { latitude: 0, longitude: Number.NaN })).toThrow('longitude');
    expect(reactionMessage('+573001234567', 'wamid.1', '')).toMatchObject({
      reaction: { message_id: 'wamid.1', emoji: '' },
    });
  });

  it('builds templates with positional and named parameters, headers and buttons', () => {
    const payload = templateMessage('+525512345678', {
      name: 'order_shipped',
      language: 'es_MX',
      header: { type: 'document', media: { link: 'https://cdn.test/guia.pdf' }, filename: 'guia.pdf' },
      body: ['Ana', 1234, { type: 'currency', currency: { fallback_value: '$10', code: 'MXN', amount_1000: 10000 } }],
      buttons: [
        { type: 'url', text: 'ORD-1' },
        { type: 'quick_reply', payload: 'track', index: 2 },
        { type: 'copy_code', code: 'SAVE10' },
      ],
      components: [{ type: 'carousel', cards: [] }],
    });
    expect(payload.template).toEqual({
      name: 'order_shipped',
      language: { code: 'es_MX' },
      components: [
        {
          type: 'header',
          parameters: [{ type: 'document', document: { link: 'https://cdn.test/guia.pdf', filename: 'guia.pdf' } }],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Ana' },
            { type: 'text', text: '1234' },
            { type: 'currency', currency: { fallback_value: '$10', code: 'MXN', amount_1000: 10000 } },
          ],
        },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'ORD-1' }] },
        { type: 'button', sub_type: 'quick_reply', index: '2', parameters: [{ type: 'payload', payload: 'track' }] },
        {
          type: 'button',
          sub_type: 'copy_code',
          index: '2',
          parameters: [{ type: 'coupon_code', coupon_code: 'SAVE10' }],
        },
        { type: 'carousel', cards: [] },
      ],
    });

    expect(
      templateMessage('+525512345678', {
        name: 'welcome',
        language: 'pt_BR',
        header: { type: 'text', text: 'Olá', parameterName: 'greeting' },
        body: { first_name: 'João' },
      }).template,
    ).toEqual({
      name: 'welcome',
      language: { code: 'pt_BR' },
      components: [
        { type: 'header', parameters: [{ type: 'text', text: 'Olá', parameter_name: 'greeting' }] },
        { type: 'body', parameters: [{ type: 'text', text: 'João', parameter_name: 'first_name' }] },
      ],
    });

    expect(templateMessage('+525512345678', { name: 'hello_world', language: 'en_US', body: [] }).template).toEqual({
      name: 'hello_world',
      language: { code: 'en_US' },
    });
    expect(
      templateMessage('+525512345678', {
        name: 'store',
        language: 'es',
        header: { type: 'location', location: { latitude: 1, longitude: 2 } },
      }).template,
    ).toMatchObject({
      components: [{ type: 'header', parameters: [{ type: 'location', location: { latitude: 1, longitude: 2 } }] }],
    });
    expect(() => templateMessage('+525512345678', { name: '', language: 'es' })).toThrow('template name');
    expect(() =>
      templateMessage('+525512345678', { name: 'x', language: 'es', buttons: [{ type: 'flow' } as never] }),
    ).toThrow('unsupported template button type "flow"');
  });

  it('builds authentication templates', () => {
    expect(authenticationTemplateMessage('+573001234567', { name: 'otp', language: 'es' }, '482913').template).toEqual({
      name: 'otp',
      language: { code: 'es' },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
      ],
    });
    expect(() =>
      authenticationTemplateMessage('+573001234567', { name: 'otp', language: 'es' }, '1'.repeat(16)),
    ).toThrow('at most 15');
  });

  it('builds reply buttons with validation', () => {
    expect(
      buttonsMessage('+573001234567', {
        header: { type: 'image', media: { id: 'img-1' } },
        body: '¿Confirmas tu pedido?',
        footer: 'Tienda',
        buttons: [
          { id: 'yes', title: 'Sí' },
          { id: 'no', title: 'No' },
        ],
      }).interactive,
    ).toEqual({
      type: 'button',
      header: { type: 'image', image: { id: 'img-1' } },
      body: { text: '¿Confirmas tu pedido?' },
      footer: { text: 'Tienda' },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'yes', title: 'Sí' } },
          { type: 'reply', reply: { id: 'no', title: 'No' } },
        ],
      },
    });
    const button = (id: string) => ({ id, title: id });
    expect(() => buttonsMessage('+573001234567', { body: 'x', buttons: [] })).toThrow('1 to 3 buttons');
    expect(() =>
      buttonsMessage('+573001234567', { body: 'x', buttons: [button('a'), button('b'), button('c'), button('d')] }),
    ).toThrow('1 to 3 buttons');
    expect(() => buttonsMessage('+573001234567', { body: 'x', buttons: [button('a'), button('a')] })).toThrow(
      'duplicate',
    );
    expect(() => buttonsMessage('+573001234567', { body: 'x', buttons: [{ id: 'a', title: 'x'.repeat(21) }] })).toThrow(
      'button title must be at most 20',
    );
  });

  it('builds lists with validation', () => {
    const payload = listMessage('+573001234567', {
      header: { type: 'text', text: 'Menú' },
      body: 'Elige una opción',
      button: 'Ver opciones',
      sections: [
        { title: 'Pedidos', rows: [{ id: 'track', title: 'Rastrear', description: 'Estado de tu pedido' }] },
        { title: 'Ayuda', rows: [{ id: 'agent', title: 'Hablar con un asesor' }] },
      ],
    });
    expect(payload.interactive).toMatchObject({
      type: 'list',
      header: { type: 'text', text: 'Menú' },
      action: {
        button: 'Ver opciones',
        sections: [
          { title: 'Pedidos', rows: [{ id: 'track', title: 'Rastrear', description: 'Estado de tu pedido' }] },
          { title: 'Ayuda', rows: [{ id: 'agent', title: 'Hablar con un asesor' }] },
        ],
      },
    });
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: `Row ${i}` }));
    expect(() => listMessage('+573001234567', { body: 'x', button: 'b', sections: [] })).toThrow('1 to 10 sections');
    expect(() => listMessage('+573001234567', { body: 'x', button: 'b', sections: [{ rows: rows(11) }] })).toThrow(
      '1 to 10 rows',
    );
    expect(() =>
      listMessage('+573001234567', {
        body: 'x',
        button: 'b',
        sections: [{ rows: rows(1) }, { title: 't', rows: rows(1) }],
      }),
    ).toThrow('needs a title');
    expect(() =>
      listMessage('+573001234567', {
        body: 'x',
        button: 'b',
        sections: [
          {
            rows: [
              { id: 'a', title: 'a' },
              { id: 'a', title: 'b' },
            ],
          },
        ],
      }),
    ).toThrow('duplicate row id');
  });

  it('builds CTA URL messages', () => {
    expect(
      ctaUrlMessage('+573001234567', {
        header: { type: 'text', text: 'Pago' },
        body: 'Completa tu pago',
        displayText: 'Pagar',
        url: 'https://pay.test/o/1',
      }).interactive,
    ).toEqual({
      type: 'cta_url',
      header: { type: 'text', text: 'Pago' },
      body: { text: 'Completa tu pago' },
      action: { name: 'cta_url', parameters: { display_text: 'Pagar', url: 'https://pay.test/o/1' } },
    });
    expect(() => ctaUrlMessage('+573001234567', { body: 'x', displayText: 'y', url: 'javascript:alert(1)' })).toThrow(
      'http(s)',
    );
  });
});
