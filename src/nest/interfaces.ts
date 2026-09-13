import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';
import type { WhatsAppConfig } from '../core/types.js';

export type WhatsAppModuleOptions = WhatsAppConfig;

export interface WhatsAppModuleRegistration {
  /** Register the module globally (default: true). */
  isGlobal?: boolean;
  /** Mount `GET` + `POST /{path}`. `false` disables it. Default: `{ path: 'whatsapp/webhook' }`. */
  webhooks?: { path?: string } | false;
}

export interface WhatsAppModuleAsyncOptions extends WhatsAppModuleRegistration, Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory: (...args: any[]) => WhatsAppModuleOptions | Promise<WhatsAppModuleOptions>;
}
