# nestjs-whatsapp

[![CI](https://github.com/JavierCardonadev/nestjs-whatsapp/actions/workflows/ci.yml/badge.svg)](https://github.com/JavierCardonadev/nestjs-whatsapp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nestjs-whatsapp.svg)](https://www.npmjs.com/package/nestjs-whatsapp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**WhatsApp Cloud API for NestJS.** Send text, templates, media and interactive messages; receive verified webhooks as typed events; build chatbots with decorators. Zero runtime dependencies, Graph API v26.0, ready for WhatsApp usernames (BSUID).

> 🇪🇸 [Leer en español](README.es.md)

```ts
@OnWhatsAppMessage({ text: /^(hi|menu)$/i })
async menu(event: MessageEvent) {
  await this.whatsapp.sendButtons(event.from.phone ?? event.from.userId!, {
    body: `Hi ${event.from.name}! What do you need?`,
    buttons: [
      { id: 'track_order', title: 'Track my order' },
      { id: 'talk_to_agent', title: 'Talk to an agent' },
    ],
  });
}
```

## Features

- **Every common message type**: text, templates (positional and named parameters, media headers, URL / quick-reply / copy-code buttons), authentication codes, image, video, audio, document, sticker, location, reactions, reply buttons, lists and CTA URL buttons.
- **Validation before the API call**: WhatsApp's limits (3 buttons, 20-character titles, 10 list rows, 4096-character text…) fail fast with a clear message instead of a Graph error.
- **Verified webhooks**: `X-Hub-Signature-256` checked over the raw bytes with a constant-time comparison, plus the `hub.challenge` handshake.
- **Normalized events**: messages, delivery statuses (with pricing and errors) and template review results, with `text`, `reply.id`, `media`, `location`… already extracted.
- **Decorators**: `@OnWhatsAppMessage({ text, type, replyId })`, `@OnWhatsAppStatus('failed')`, `@OnWhatsAppTemplateStatus()`.
- **Usernames and BSUIDs** (2026): users are identified by `userId` even when WhatsApp hides their phone number, and you can reply to either.
- **Media and templates**: upload, download and delete media; list, create and delete templates.
- **Typed errors**: `WhatsAppApiError` with `code`, `details`, `fbtraceId` and helpers like `isOutsideCustomerServiceWindow`.
- **NestJS 11 and 12**, or the framework-agnostic `WhatsAppClient` anywhere Node runs.

## Install

```bash
npm install nestjs-whatsapp
```

Node.js ≥ 20.19. The package is ESM; CommonJS Nest apps can load it on Node ≥ 20.19.

## Setup

You need a Meta app with the WhatsApp product ([getting started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)):

| Option              | Where to find it                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `accessToken`       | Business settings → System users → Generate token (`whatsapp_business_messaging`, plus `whatsapp_business_management` for templates) |
| `phoneNumberId`     | App Dashboard → WhatsApp → API Setup                                                                                                 |
| `businessAccountId` | Same page, "WhatsApp Business Account ID" (only for templates)                                                                       |
| `appSecret`         | App Dashboard → App settings → Basic                                                                                                 |
| `verifyToken`       | Any random string you choose                                                                                                         |

```ts
import { WhatsAppModule } from 'nestjs-whatsapp';

@Module({
  imports: [
    WhatsAppModule.forRoot({
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      appSecret: process.env.WHATSAPP_APP_SECRET,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    }),
  ],
})
export class AppModule {}
```

Keep the raw body so signatures can be verified:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Then, in the App Dashboard → WhatsApp → Configuration, set the callback URL to `https://your.app/whatsapp/webhook`, enter your verify token and subscribe to the `messages` field (and `message_template_status_update` if you manage templates).

`forRootAsync({ imports, inject, useFactory })` is available for `ConfigService`. Change the path with `webhooks: { path: 'hooks/wa' }` or disable the controller with `webhooks: false`.

## Sending messages

Inject `WhatsAppClient`:

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly whatsapp: WhatsAppClient) {}

  async shipped(order: Order) {
    // Business-initiated conversations need an approved template.
    await this.whatsapp.sendTemplate(order.phone, {
      name: 'order_shipped',
      language: 'es',
      body: [order.customerName, order.id], // or named: { customer: 'Ana', order: 'ORD-1' }
      buttons: [{ type: 'url', text: order.trackingCode }],
    });
  }
}
```

Inside the 24-hour customer service window you can send anything:

```ts
await whatsapp.sendText(to, 'Your order is on its way 🚚', { replyTo: event.id });
await whatsapp.sendImage(to, { link: 'https://cdn.example.com/receipt.png' }, { caption: 'Receipt' });
await whatsapp.sendDocument(to, { id: mediaId }, { filename: 'invoice.pdf' });
await whatsapp.sendLocation(to, { latitude: 4.711, longitude: -74.072, name: 'Store' });
await whatsapp.sendReaction(to, event.id, '👍');
await whatsapp.sendList(to, {
  body: 'Choose a plan',
  button: 'See plans',
  sections: [{ title: 'Plans', rows: [{ id: 'pro', title: 'Pro', description: '$19/month' }] }],
});
await whatsapp.sendCtaUrl(to, { body: 'Complete your payment', displayText: 'Pay now', url: checkoutUrl });
await whatsapp.sendAuthenticationCode(to, { name: 'login_code', language: 'en_US' }, '482913');
await whatsapp.markAsRead(event.id, { typing: true });
```

`to` accepts an E.164 phone number (`+573001234567`) or a business-scoped user id (`CO.13491208655302741918`). Anything else — contacts, carousels, Flows — goes through `whatsapp.send(payload)`, and every builder (`textMessage`, `templateMessage`, `buttonsMessage`…) is exported if you want to inspect or queue payloads.

## Receiving messages

```ts
@Injectable()
export class Chatbot {
  constructor(private readonly whatsapp: WhatsAppClient) {}

  @OnWhatsAppMessage({ replyId: 'track_order' })
  async track(event: MessageEvent) {}

  @OnWhatsAppMessage(['image', 'document'])
  async receipt(event: MessageEvent) {
    const file = await this.whatsapp.downloadMedia(event.media!.id); // { data: Buffer, mimeType, sha256, … }
  }

  @OnWhatsAppStatus(['delivered', 'read'])
  async delivery(event: StatusEvent) {}

  @OnWhatsAppStatus('failed')
  async failed(event: StatusEvent) {} // event.errors: [{ code: 131026, title, details }]

  @OnWhatsAppTemplateStatus()
  async review(event: TemplateStatusEvent) {} // APPROVED, REJECTED (event.reason)…
}
```

| Filter                                  | Matches                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `text: 'hola'`                          | `event.text` equal to "hola", trimmed and case-insensitive                  |
| `text: /pedido/i`                       | a regular expression                                                        |
| `replyId: 'yes'` / `/^plan_/`           | the id of the tapped button or list row (or a template quick reply payload) |
| `type: 'image'` or `['image', 'video']` | message types                                                               |

`event.text` holds the human-readable content of any message: the body, a media caption, or the title of the tapped button. Also available: `media`, `location`, `reaction`, `context` (quoted/forwarded), `referral` (click-to-WhatsApp ads) and `flow` (WhatsApp Flows responses).

Handlers run before Meta receives `200`. If one throws, the webhook answers `500` and Meta retries, so **make handlers idempotent** with `event.id` (messages) or `event.messageId + event.status` (statuses). Events of one request are processed in order. Invalid signatures get `401`.

Prefer streams? Inject `WhatsAppEventsService`: `events$` is an observable, and `onMessage()`, `onStatus()` and `onTemplateStatus()` return unsubscribe functions.

### Usernames and phone numbers

Since 2026 WhatsApp users can hide their number behind a username. Every message carries `event.from.userId` (a BSUID such as `CO.13491208655302741918`), but `event.from.phone` may be missing if you haven't talked to that user in the last 30 days. **Store `userId` next to the phone**, and reply with `event.from.phone ?? event.from.userId`.

## Errors

```ts
try {
  await whatsapp.sendText(to, 'Hi again!');
} catch (error) {
  if (error instanceof WhatsAppApiError && error.isOutsideCustomerServiceWindow) {
    await whatsapp.sendTemplate(to, { name: 'follow_up', language: 'en_US' });
  } else if (error instanceof WhatsAppApiError && error.isRateLimited) {
    // retry with backoff
  } else throw error;
}
```

`WhatsAppApiError` exposes `httpStatus`, `code`, `subcode`, `details`, `fbtraceId`, `raw` and the helpers `isOutsideCustomerServiceWindow` (131047), `isRateLimited` and `isAuthError`. `WHATSAPP_ERROR_CODES` names the common codes. Invalid input throws `WhatsAppValidationError` before any request is made.

## Media and templates

```ts
const id = await whatsapp.uploadMedia(buffer, 'application/pdf', { filename: 'invoice.pdf' });
const info = await whatsapp.getMedia(id); // short-lived URL, mime type, size
await whatsapp.deleteMedia(id);

const { templates, nextCursor } = await whatsapp.listTemplates({ status: 'APPROVED' });
await whatsapp.createTemplate({
  name: 'order_shipped',
  language: 'es',
  category: 'UTILITY',
  components: [
    { type: 'BODY', text: 'Hola {{1}}, tu pedido {{2}} fue enviado.', example: { body_text: [['Ana', 'ORD-1']] } },
  ],
});
await whatsapp.deleteTemplate('order_shipped');
```

## Without NestJS

```ts
import express from 'express';
import { WhatsAppClient } from 'nestjs-whatsapp/core';

const whatsapp = new WhatsAppClient({ accessToken, phoneNumberId, appSecret, verifyToken });
const app = express();

app.get('/webhook', (req, res) => {
  try {
    res.type('text/plain').send(whatsapp.verifyWebhookChallenge(req.query));
  } catch {
    res.sendStatus(403);
  }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let events;
  try {
    events = whatsapp.parseWebhook({ headers: req.headers, rawBody: req.body });
  } catch {
    return res.sendStatus(401);
  }
  for (const event of events) {
    if (event.kind === 'message' && event.text) {
      await whatsapp.sendText(event.from.phone ?? event.from.userId!, `You said: ${event.text}`);
    }
  }
  res.sendStatus(200);
});
```

## Security

- Always configure `appSecret`: unsigned webhooks are rejected, never processed.
- The access token grants sending on behalf of your business: keep it server-side and prefer system user tokens.
- Phone numbers, names and message content are personal data — log ids, not payloads.

See [SECURITY.md](SECURITY.md) to report vulnerabilities.

## Roadmap

WhatsApp Flows helpers, typed contacts and carousel builders, multi-number routing, Calling API events, a pluggable fallback channel (SMS / email). Ideas and PRs welcome.

## Need help with WhatsApp or a LATAM product?

I'm Javier Cardona, a full-stack developer in Colombia. I build WhatsApp chatbots, notification pipelines and the backends around them — payments, e-invoicing and integrations for Latin America. See also [nestjs-latam-payments](https://github.com/JavierCardonadev/nestjs-latam-payments) and [nestjs-intl-validators](https://github.com/JavierCardonadev/nestjs-intl-validators).

👉 **[javiercardona.dev](https://javiercardona.dev)**

## License

[MIT](LICENSE) © Javier Cardona. Not affiliated with Meta or WhatsApp. WhatsApp is a trademark of WhatsApp LLC.
