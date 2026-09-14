# nestjs-whatsapp

[![CI](https://github.com/JavierCardonadev/nestjs-whatsapp/actions/workflows/ci.yml/badge.svg)](https://github.com/JavierCardonadev/nestjs-whatsapp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/nestjs-whatsapp.svg)](https://www.npmjs.com/package/nestjs-whatsapp)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)

**WhatsApp Cloud API para NestJS.** Envía textos, plantillas, archivos y mensajes interactivos; recibe webhooks verificados como eventos tipados; construye chatbots con decoradores. Cero dependencias, Graph API v26.0 y listo para los usernames de WhatsApp (BSUID).

> 🇺🇸 [Read in English](README.md)

```ts
@OnWhatsAppMessage({ text: /^(hola|menu)$/i })
async menu(event: MessageEvent) {
  await this.whatsapp.sendButtons(event.from.phone ?? event.from.userId!, {
    body: `¡Hola ${event.from.name}! ¿Qué necesitas?`,
    buttons: [
      { id: 'track_order', title: 'Rastrear pedido' },
      { id: 'talk_to_agent', title: 'Hablar con asesor' },
    ],
  });
}
```

## Características

- **Todos los tipos de mensaje habituales**: texto, plantillas (parámetros posicionales y con nombre, encabezados multimedia, botones URL / respuesta rápida / copiar código), códigos de autenticación, imagen, video, audio, documento, sticker, ubicación, reacciones, botones de respuesta, listas y botones CTA con URL.
- **Validación antes de llamar a la API**: los límites de WhatsApp (3 botones, títulos de 20 caracteres, 10 filas en listas, textos de 4096…) fallan de inmediato con un mensaje claro en vez de un error de Graph.
- **Webhooks verificados**: `X-Hub-Signature-256` sobre los bytes crudos con comparación en tiempo constante, más el handshake de `hub.challenge`.
- **Eventos normalizados**: mensajes, estados de entrega (con precio y errores) y resultados de revisión de plantillas, con `text`, `reply.id`, `media`, `location`… ya extraídos.
- **Decoradores**: `@OnWhatsAppMessage({ text, type, replyId })`, `@OnWhatsAppStatus('failed')`, `@OnWhatsAppTemplateStatus()`.
- **Usernames y BSUID** (2026): los usuarios se identifican por `userId` aunque WhatsApp oculte su número, y puedes responder a cualquiera de los dos.
- **Archivos y plantillas**: subir, descargar y borrar archivos; listar, crear y borrar plantillas.
- **Errores tipados**: `WhatsAppApiError` con `code`, `details`, `fbtraceId` y ayudas como `isOutsideCustomerServiceWindow`.
- **NestJS 11 y 12**, o el `WhatsAppClient` independiente del framework donde corra Node.

## Instalación

```bash
npm install nestjs-whatsapp
```

Node.js ≥ 20.19. El paquete es ESM; las apps Nest en CommonJS pueden cargarlo desde Node 20.19.

## Configuración

Necesitas una app de Meta con el producto WhatsApp ([primeros pasos](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)):

| Opción              | Dónde encontrarla                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessToken`       | Configuración del negocio → Usuarios del sistema → Generar token (`whatsapp_business_messaging`, y `whatsapp_business_management` para plantillas) |
| `phoneNumberId`     | Panel de la app → WhatsApp → Configuración de la API                                                                                               |
| `businessAccountId` | Misma página, "ID de la cuenta de WhatsApp Business" (solo para plantillas)                                                                        |
| `appSecret`         | Panel de la app → Configuración → Básica                                                                                                           |
| `verifyToken`       | Cualquier cadena aleatoria que elijas                                                                                                              |

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

Conserva el raw body para poder verificar las firmas:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
```

Luego, en Panel de la app → WhatsApp → Configuración, pon como URL de callback `https://tu.app/whatsapp/webhook`, escribe tu verify token y suscríbete al campo `messages` (y a `message_template_status_update` si gestionas plantillas).

Existe `forRootAsync({ imports, inject, useFactory })` para usar `ConfigService`. Cambia la ruta con `webhooks: { path: 'hooks/wa' }` o desactiva el controlador con `webhooks: false`.

## Enviar mensajes

Inyecta `WhatsAppClient`:

```ts
@Injectable()
export class OrdersService {
  constructor(private readonly whatsapp: WhatsAppClient) {}

  async shipped(order: Order) {
    // Las conversaciones que inicia el negocio requieren una plantilla aprobada.
    await this.whatsapp.sendTemplate(order.phone, {
      name: 'order_shipped',
      language: 'es',
      body: [order.customerName, order.id], // o con nombre: { customer: 'Ana', order: 'ORD-1' }
      buttons: [{ type: 'url', text: order.trackingCode }],
    });
  }
}
```

Dentro de la ventana de atención de 24 horas puedes enviar cualquier cosa:

```ts
await whatsapp.sendText(to, 'Tu pedido va en camino 🚚', { replyTo: event.id });
await whatsapp.sendImage(to, { link: 'https://cdn.example.com/recibo.png' }, { caption: 'Recibo' });
await whatsapp.sendDocument(to, { id: mediaId }, { filename: 'factura.pdf' });
await whatsapp.sendLocation(to, { latitude: 4.711, longitude: -74.072, name: 'Tienda' });
await whatsapp.sendReaction(to, event.id, '👍');
await whatsapp.sendList(to, {
  body: 'Elige un plan',
  button: 'Ver planes',
  sections: [{ title: 'Planes', rows: [{ id: 'pro', title: 'Pro', description: '$79.900/mes' }] }],
});
await whatsapp.sendCtaUrl(to, { body: 'Completa tu pago', displayText: 'Pagar', url: checkoutUrl });
await whatsapp.sendAuthenticationCode(to, { name: 'login_code', language: 'es' }, '482913');
await whatsapp.markAsRead(event.id, { typing: true });
```

`to` acepta un teléfono E.164 (`+573001234567`) o un id de usuario del negocio (`CO.13491208655302741918`). Todo lo demás —contactos, carruseles, Flows— va por `whatsapp.send(payload)`, y todos los constructores (`textMessage`, `templateMessage`, `buttonsMessage`…) están exportados por si quieres inspeccionar o encolar los payloads.

## Recibir mensajes

```ts
@Injectable()
export class Chatbot {
  constructor(private readonly whatsapp: WhatsAppClient) {}

  @OnWhatsAppMessage({ replyId: 'track_order' })
  async rastrear(event: MessageEvent) {}

  @OnWhatsAppMessage(['image', 'document'])
  async comprobante(event: MessageEvent) {
    const file = await this.whatsapp.downloadMedia(event.media!.id); // { data: Buffer, mimeType, sha256, … }
  }

  @OnWhatsAppStatus(['delivered', 'read'])
  async entrega(event: StatusEvent) {}

  @OnWhatsAppStatus('failed')
  async fallo(event: StatusEvent) {} // event.errors: [{ code: 131026, title, details }]

  @OnWhatsAppTemplateStatus()
  async revision(event: TemplateStatusEvent) {} // APPROVED, REJECTED (event.reason)…
}
```

| Filtro                                 | Coincide con                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `text: 'hola'`                         | `event.text` igual a "hola", sin espacios y sin distinguir mayúsculas             |
| `text: /pedido/i`                      | una expresión regular                                                             |
| `replyId: 'yes'` / `/^plan_/`          | el id del botón o fila tocada (o el payload de una respuesta rápida de plantilla) |
| `type: 'image'` o `['image', 'video']` | tipos de mensaje                                                                  |

`event.text` contiene el contenido legible de cualquier mensaje: el cuerpo, el pie de foto o el título del botón tocado. También tienes `media`, `location`, `reaction`, `context` (citado/reenviado), `referral` (anuncios click-to-WhatsApp) y `flow` (respuestas de WhatsApp Flows).

Los handlers corren antes de que Meta reciba el `200`. Si uno lanza error, el webhook responde `500` y Meta reintenta, así que **haz tus handlers idempotentes** con `event.id` (mensajes) o `event.messageId + event.status` (estados). Los eventos de una misma petición se procesan en orden. Las firmas inválidas reciben `401`.

¿Prefieres streams? Inyecta `WhatsAppEventsService`: `events$` es un observable, y `onMessage()`, `onStatus()` y `onTemplateStatus()` devuelven funciones para cancelar la suscripción.

### Usernames y números de teléfono

Desde 2026 los usuarios de WhatsApp pueden ocultar su número detrás de un username. Todo mensaje trae `event.from.userId` (un BSUID como `CO.13491208655302741918`), pero `event.from.phone` puede faltar si no has hablado con ese usuario en los últimos 30 días. **Guarda el `userId` junto al teléfono** y responde con `event.from.phone ?? event.from.userId`.

## Errores

```ts
try {
  await whatsapp.sendText(to, '¡Hola de nuevo!');
} catch (error) {
  if (error instanceof WhatsAppApiError && error.isOutsideCustomerServiceWindow) {
    await whatsapp.sendTemplate(to, { name: 'seguimiento', language: 'es' });
  } else if (error instanceof WhatsAppApiError && error.isRateLimited) {
    // reintenta con backoff
  } else throw error;
}
```

`WhatsAppApiError` expone `httpStatus`, `code`, `subcode`, `details`, `fbtraceId`, `raw` y las ayudas `isOutsideCustomerServiceWindow` (131047), `isRateLimited` e `isAuthError`. `WHATSAPP_ERROR_CODES` nombra los códigos comunes. Una entrada inválida lanza `WhatsAppValidationError` antes de hacer cualquier petición.

## Archivos y plantillas

```ts
const id = await whatsapp.uploadMedia(buffer, 'application/pdf', { filename: 'factura.pdf' });
const info = await whatsapp.getMedia(id); // URL temporal, tipo MIME, tamaño
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

## Sin NestJS

El núcleo está en `nestjs-whatsapp/core` y funciona con Express, Fastify, workers o scripts. Hay un ejemplo completo con Express en el [README en inglés](README.md#without-nestjs) y una app Nest de chatbot en [examples/nest-app](examples/nest-app).

## Seguridad

- Configura siempre `appSecret`: los webhooks sin firma válida se rechazan, nunca se procesan.
- El access token permite enviar en nombre de tu negocio: mantenlo en el servidor y prefiere tokens de usuario del sistema.
- Teléfonos, nombres y contenido de mensajes son datos personales: registra ids, no payloads.

Ver [SECURITY.md](SECURITY.md) para reportar vulnerabilidades.

## Hoja de ruta

Helpers para WhatsApp Flows, constructores tipados de contactos y carruseles, enrutamiento multi-número, eventos de la Calling API y un canal de respaldo configurable (SMS / email). Ideas y PRs bienvenidos.

## ¿Necesitas ayuda con WhatsApp o un producto para LATAM?

Soy Javier Cardona, desarrollador full-stack en Colombia. Construyo chatbots de WhatsApp, sistemas de notificaciones y los backends a su alrededor: pagos, facturación electrónica e integraciones para Latinoamérica. Mira también [nestjs-latam-payments](https://github.com/JavierCardonadev/nestjs-latam-payments), [nestjs-einvoicing](https://github.com/JavierCardonadev/nestjs-einvoicing), [nestjs-intl-validators](https://github.com/JavierCardonadev/nestjs-intl-validators) y [nestjs-shipping](https://github.com/JavierCardonadev/nestjs-shipping).

👉 **[javiercardona.dev](https://javiercardona.dev)**

## Licencia

[MIT](LICENSE) © Javier Cardona. Sin afiliación con Meta ni WhatsApp. WhatsApp es una marca de WhatsApp LLC.
