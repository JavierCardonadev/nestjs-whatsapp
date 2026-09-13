import { Injectable, Logger } from '@nestjs/common';
import {
  OnWhatsAppMessage,
  OnWhatsAppStatus,
  WhatsAppClient,
  type MessageEvent,
  type StatusEvent,
} from '../../src/index.js';

@Injectable()
export class ChatbotListener {
  private readonly logger = new Logger(ChatbotListener.name);
  /** Replace with a table and a unique index on the message id. */
  private readonly seen = new Set<string>();

  constructor(private readonly whatsapp: WhatsAppClient) {}

  /** Reply to the user id when there is no phone (usernames), otherwise to the phone. */
  private recipient(event: MessageEvent) {
    return event.from.phone ?? event.from.userId!;
  }

  private firstTime(event: MessageEvent) {
    if (this.seen.has(event.id)) return false; // Meta retries; stay idempotent
    this.seen.add(event.id);
    return true;
  }

  @OnWhatsAppMessage({ text: /^(hola|hi|menu|menú)$/i })
  async menu(event: MessageEvent) {
    if (!this.firstTime(event)) return;
    await this.whatsapp.markAsRead(event.id, { typing: true });
    await this.whatsapp.sendButtons(this.recipient(event), {
      body: `¡Hola ${event.from.name ?? ''}! ¿Qué necesitas?`,
      buttons: [
        { id: 'track_order', title: 'Rastrear pedido' },
        { id: 'talk_to_agent', title: 'Hablar con asesor' },
      ],
    });
  }

  @OnWhatsAppMessage({ replyId: 'track_order' })
  async track(event: MessageEvent) {
    if (!this.firstTime(event)) return;
    await this.whatsapp.sendText(this.recipient(event), 'Envíame el número de tu pedido, por ejemplo ORD-1234.', {
      replyTo: event.id,
    });
  }

  @OnWhatsAppMessage({ type: 'image' })
  async receipt(event: MessageEvent) {
    if (!this.firstTime(event)) return;
    const file = await this.whatsapp.downloadMedia(event.media!.id);
    this.logger.log(`Got a ${file.mimeType} of ${file.fileSize} bytes`);
    await this.whatsapp.sendReaction(this.recipient(event), event.id, '✅');
  }

  @OnWhatsAppStatus('failed')
  failed(event: StatusEvent) {
    this.logger.warn(
      `Message ${event.messageId} failed: ${event.errors?.map((e) => `${e.code} ${e.title}`).join(', ')}`,
    );
  }
}
