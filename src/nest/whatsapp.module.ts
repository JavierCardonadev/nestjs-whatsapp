import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { WhatsAppClient } from '../core/client.js';
import { DEFAULT_WEBHOOK_PATH, WHATSAPP_OPTIONS } from './constants.js';
import type { WhatsAppModuleAsyncOptions, WhatsAppModuleOptions, WhatsAppModuleRegistration } from './interfaces.js';
import { createWhatsAppWebhookController } from './webhook.controller.js';
import { WhatsAppEventsService } from './whatsapp-events.service.js';

@Module({})
export class WhatsAppModule {
  static forRoot(options: WhatsAppModuleOptions & WhatsAppModuleRegistration): DynamicModule {
    const { isGlobal, webhooks, ...config } = options;
    return WhatsAppModule.build({ isGlobal, webhooks }, [{ provide: WHATSAPP_OPTIONS, useValue: config }]);
  }

  static forRootAsync(options: WhatsAppModuleAsyncOptions): DynamicModule {
    return WhatsAppModule.build(
      options,
      [{ provide: WHATSAPP_OPTIONS, useFactory: options.useFactory, inject: options.inject ?? [] }],
      options.imports,
    );
  }

  private static build(
    registration: WhatsAppModuleRegistration,
    optionProviders: Provider[],
    imports: DynamicModule['imports'] = [],
  ): DynamicModule {
    const webhooks = registration.webhooks === false ? false : { path: DEFAULT_WEBHOOK_PATH, ...registration.webhooks };
    return {
      module: WhatsAppModule,
      global: registration.isGlobal ?? true,
      imports: [DiscoveryModule, ...imports],
      controllers: webhooks ? [createWhatsAppWebhookController(webhooks.path)] : [],
      providers: [
        ...optionProviders,
        {
          provide: WhatsAppClient,
          useFactory: (config: WhatsAppModuleOptions) => new WhatsAppClient(config),
          inject: [WHATSAPP_OPTIONS],
        },
        WhatsAppEventsService,
      ],
      exports: [WhatsAppClient, WhatsAppEventsService],
    };
  }
}
