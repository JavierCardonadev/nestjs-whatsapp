import { Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OnWhatsAppEvent,
  OnWhatsAppMessage,
  OnWhatsAppStatus,
  OnWhatsAppTemplateStatus,
  WhatsAppClient,
  WhatsAppEventsService,
  WhatsAppModule,
  type MessageEvent,
  type StatusEvent,
  type TemplateStatusEvent,
  type WhatsAppEvent,
} from '../src/index.js';
import {
  APP_SECRET,
  sentStatusValue,
  signed,
  textMessageValue,
  VERIFY_TOKEN,
  webhookBody,
} from './helpers/fixtures.js';
import { mockFetch } from './helpers/mock-fetch.js';

@Injectable()
class ChatbotListener {
  readonly greetings: MessageEvent[] = [];
  readonly confirmations: MessageEvent[] = [];
  readonly images: MessageEvent[] = [];
  readonly failures: StatusEvent[] = [];
  readonly templates: TemplateStatusEvent[] = [];
  readonly all: WhatsAppEvent[] = [];
  failNext = false;

  @OnWhatsAppMessage({ text: /^(hola|hi)$/i })
  greet(event: MessageEvent) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('database down');
    }
    this.greetings.push(event);
  }

  @OnWhatsAppMessage({ replyId: 'confirm' })
  confirm(event: MessageEvent) {
    this.confirmations.push(event);
  }

  @OnWhatsAppMessage(['image', 'document'])
  media(event: MessageEvent) {
    this.images.push(event);
  }

  @OnWhatsAppStatus('failed')
  failed(event: StatusEvent) {
    this.failures.push(event);
  }

  @OnWhatsAppTemplateStatus()
  template(event: TemplateStatusEvent) {
    this.templates.push(event);
  }

  @OnWhatsAppEvent()
  any(event: WhatsAppEvent) {
    this.all.push(event);
  }
}

const config = {
  accessToken: 'token',
  phoneNumberId: '106540352242922',
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
};

describe('WhatsAppModule', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(module: ReturnType<typeof WhatsAppModule.forRoot>, { rawBody = true } = {}) {
    const ref = await Test.createTestingModule({ imports: [module], providers: [ChatbotListener] }).compile();
    app = ref.createNestApplication({ rawBody, logger: false });
    await app.init();
    return { server: app.getHttpServer(), listener: ref.get(ChatbotListener), ref };
  }

  const post = (server: unknown, body: unknown, secret?: string, path = '/whatsapp/webhook') => {
    const { rawBody, headers } = signed(body, secret);
    return request(server as never)
      .post(path)
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(rawBody.toString());
  };

  it('answers the verification challenge', async () => {
    const { server } = await boot(WhatsAppModule.forRoot(config));
    const ok = await request(server)
      .get('/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' })
      .expect(200);
    expect(ok.text).toBe('1158201444');
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    await request(server)
      .get('/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })
      .expect(403);
  });

  it('answers 500 when the verify token is not configured', async () => {
    const { server } = await boot(WhatsAppModule.forRoot({ ...config, verifyToken: undefined }));
    await request(server).get('/whatsapp/webhook').query({ 'hub.mode': 'subscribe' }).expect(500);
  });

  it('verifies, normalizes and dispatches events to decorated handlers', async () => {
    const { server, listener } = await boot(WhatsAppModule.forRoot(config));
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                ...textMessageValue,
                messages: [
                  textMessageValue.messages[0],
                  {
                    ...textMessageValue.messages[0],
                    id: 'wamid.2',
                    type: 'interactive',
                    interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'Confirmar' } },
                  },
                  { ...textMessageValue.messages[0], id: 'wamid.3', type: 'image', image: { id: 'img' } },
                  { ...textMessageValue.messages[0], id: 'wamid.4', text: { body: 'otra cosa' } },
                ],
              },
            },
            {
              field: 'messages',
              value: { statuses: [{ ...sentStatusValue.statuses[0], status: 'failed', errors: [{ code: 131026 }] }] },
            },
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_id: 1, message_template_name: 'promo' },
            },
          ],
        },
      ],
    };

    const res = await post(server, body).expect(200);
    expect(res.body).toEqual({ received: 6 });
    expect(listener.greetings.map((e) => e.id)).toEqual(['wamid.HBgMNTczMDAxMjM0NTY3FQIAEhgUM0EwRkY']);
    expect(listener.confirmations.map((e) => e.reply?.id)).toEqual(['confirm']);
    expect(listener.images.map((e) => e.id)).toEqual(['wamid.3']);
    expect(listener.failures).toHaveLength(1);
    expect(listener.templates.map((e) => e.event)).toEqual(['APPROVED']);
    expect(listener.all.map((e) => e.kind)).toEqual([
      'message',
      'message',
      'message',
      'message',
      'status',
      'template_status',
    ]);
  });

  it('answers 401 on invalid signatures without running handlers', async () => {
    const { server, listener } = await boot(WhatsAppModule.forRoot(config));
    await post(server, webhookBody(textMessageValue), 'forged').expect(401);
    expect(listener.all).toHaveLength(0);
  });

  it('answers 500 when a handler fails so Meta retries', async () => {
    const { server, listener } = await boot(WhatsAppModule.forRoot(config));
    listener.failNext = true;
    await post(server, webhookBody(textMessageValue)).expect(500);
    await post(server, webhookBody(textMessageValue)).expect(200);
    expect(listener.greetings).toHaveLength(1);
  });

  it('answers 500 without raw body or app secret', async () => {
    let booted = await boot(WhatsAppModule.forRoot(config), { rawBody: false });
    await post(booted.server, webhookBody(textMessageValue)).expect(500);
    await app!.close();

    booted = await boot(WhatsAppModule.forRoot({ ...config, appSecret: undefined }));
    await post(booted.server, webhookBody(textMessageValue)).expect(500);
    expect(booted.listener.all).toHaveLength(0);
  });

  it('supports a custom path, async config, disabling the controller and programmatic handlers', async () => {
    const mock = mockFetch([
      {
        method: 'POST',
        url: 'https://graph.facebook.com/v26.0/106540352242922/messages',
        body: { messages: [{ id: 'wamid.out' }] },
      },
    ]);
    let booted = await boot(
      WhatsAppModule.forRootAsync({
        useFactory: async () => ({ ...config, fetch: mock.fetch }),
        webhooks: { path: 'hooks/wa' },
      }),
    );
    const events = booted.ref.get(WhatsAppEventsService);
    const onMessage = vi.fn();
    const onStatus = vi.fn();
    const onTemplate = vi.fn();
    const stream = vi.fn();
    const off = events.onMessage(onMessage, { type: 'text' });
    events.onStatus(onStatus, ['sent']);
    events.onTemplateStatus(onTemplate);
    events.events$.subscribe(stream);

    await post(booted.server, webhookBody(textMessageValue), undefined, '/hooks/wa').expect(200);
    await post(booted.server, webhookBody(sentStatusValue), undefined, '/hooks/wa').expect(200);
    off();
    await post(booted.server, webhookBody(textMessageValue), undefined, '/hooks/wa').expect(200);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onTemplate).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(3);

    const client = booted.ref.get(WhatsAppClient);
    expect((await client.sendText('+573001234567', 'hola')).id).toBe('wamid.out');
    await app!.close();

    booted = await boot(WhatsAppModule.forRoot({ ...config, webhooks: false }));
    await post(booted.server, webhookBody(textMessageValue)).expect(404);
  });
});
