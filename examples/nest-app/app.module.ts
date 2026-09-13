import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../../src/index.js';
import { ChatbotListener } from './chatbot.listener.js';
import { NotificationsController } from './notifications.controller.js';

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
  controllers: [NotificationsController],
  providers: [ChatbotListener],
})
export class AppModule {}
