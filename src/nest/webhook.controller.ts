import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type Type,
} from '@nestjs/common';
import { WhatsAppClient } from '../core/client.js';
import { WhatsAppConfigurationError, WhatsAppWebhookError } from '../core/errors.js';
import { WhatsAppEventsService } from './whatsapp-events.service.js';

export function createWhatsAppWebhookController(path: string): Type<unknown> {
  @Controller(path)
  class WhatsAppWebhookController {
    private readonly logger = new Logger('WhatsAppWebhook');

    constructor(
      private readonly client: WhatsAppClient,
      private readonly events: WhatsAppEventsService,
    ) {}

    /** Meta's subscription check when you save the callback URL. */
    @Get()
    @Header('Content-Type', 'text/plain')
    verify(@Query() query: Record<string, unknown>): string {
      try {
        return this.client.verifyWebhookChallenge(query);
      } catch (error) {
        if (error instanceof WhatsAppWebhookError) throw new ForbiddenException('verification failed');
        this.logger.error((error as Error).message);
        throw new InternalServerErrorException('webhook verification is not configured');
      }
    }

    @Post()
    @HttpCode(200)
    async receive(
      @Req() req: { rawBody?: Buffer },
      @Headers() headers: Record<string, string | string[] | undefined>,
    ): Promise<{ received: number }> {
      if (!req.rawBody) {
        this.logger.error('rawBody is missing: create the app with NestFactory.create(AppModule, { rawBody: true })');
        throw new InternalServerErrorException('webhook raw body unavailable');
      }

      let events;
      try {
        events = this.client.parseWebhook({ headers, rawBody: req.rawBody });
      } catch (error) {
        if (error instanceof WhatsAppWebhookError) {
          this.logger.warn(error.message);
          throw new UnauthorizedException('invalid webhook signature');
        }
        if (error instanceof WhatsAppConfigurationError) this.logger.error(error.message);
        throw error;
      }

      // In order: a chatbot must see a user's messages in the sequence they were sent.
      for (const event of events) await this.events.emit(event);
      return { received: events.length };
    }
  }

  return WhatsAppWebhookController;
}
