import { Body, Controller, Post } from '@nestjs/common';
import { WhatsAppApiError, WhatsAppClient } from '../../src/index.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly whatsapp: WhatsAppClient) {}

  /** Business-initiated messages must use an approved template. */
  @Post('order-shipped')
  async orderShipped(@Body() body: { phone: string; name: string; orderId: string; trackingUrlSuffix: string }) {
    try {
      const message = await this.whatsapp.sendTemplate(
        body.phone,
        {
          name: 'order_shipped',
          language: 'es',
          body: [body.name, body.orderId],
          buttons: [{ type: 'url', text: body.trackingUrlSuffix }],
        },
        { callbackData: body.orderId },
      );
      return { messageId: message.id };
    } catch (error) {
      if (error instanceof WhatsAppApiError && error.isRateLimited) return { retryLater: true };
      throw error;
    }
  }
}
