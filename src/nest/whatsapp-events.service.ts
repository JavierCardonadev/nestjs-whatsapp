import { Injectable, Logger, SetMetadata, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Subject, type Observable } from 'rxjs';
import type {
  IncomingMessageType,
  MessageEvent,
  MessageStatus,
  StatusEvent,
  TemplateStatusEvent,
  WhatsAppEvent,
} from '../core/types.js';
import { WHATSAPP_EVENT_HANDLER } from './constants.js';

export interface MessageFilter {
  /** Only these message types, e.g. `'text'` or `['image', 'document']`. */
  type?: IncomingMessageType | IncomingMessageType[];
  /** Exact text (trimmed, case-insensitive) or a regular expression tested against `event.text`. */
  text?: string | RegExp;
  /** Id of the tapped button / list row (`event.reply.id`), exact or a regular expression. */
  replyId?: string | RegExp;
}

export type HandlerMatcher =
  | { kind: 'message'; filter?: MessageFilter }
  | { kind: 'status'; statuses?: MessageStatus[] }
  | { kind: 'template_status' }
  | { kind: '*' };

type Handler = (event: any) => unknown | Promise<unknown>;

/**
 * Handles incoming messages. Handlers run before Meta gets its `200`: if one throws,
 * the webhook answers `500` and Meta retries, so make them idempotent with `event.id`.
 *
 * ```ts
 * @OnWhatsAppMessage({ text: /^(hola|hi)$/i })
 * greet(event: MessageEvent) {}
 *
 * @OnWhatsAppMessage({ replyId: 'confirm_order' })
 * confirm(event: MessageEvent) {}
 * ```
 */
export const OnWhatsAppMessage = (filter?: MessageFilter | IncomingMessageType | IncomingMessageType[]) =>
  SetMetadata<string, HandlerMatcher>(WHATSAPP_EVENT_HANDLER, {
    kind: 'message',
    filter: typeof filter === 'string' || Array.isArray(filter) ? { type: filter } : filter,
  });

/** Handles delivery statuses of messages you sent: `sent`, `delivered`, `read`, `failed`. */
export const OnWhatsAppStatus = (status?: MessageStatus | MessageStatus[]) =>
  SetMetadata<string, HandlerMatcher>(WHATSAPP_EVENT_HANDLER, {
    kind: 'status',
    statuses: status === undefined ? undefined : [status].flat(),
  });

/** Handles template review results (`APPROVED`, `REJECTED`, `PAUSED`…). */
export const OnWhatsAppTemplateStatus = () =>
  SetMetadata<string, HandlerMatcher>(WHATSAPP_EVENT_HANDLER, { kind: 'template_status' });

/** Handles every webhook event, including fields this library doesn't normalize. */
export const OnWhatsAppEvent = () => SetMetadata<string, HandlerMatcher>(WHATSAPP_EVENT_HANDLER, { kind: '*' });

function matchesPattern(value: string | undefined, pattern: string | RegExp): boolean {
  if (value === undefined) return false;
  return typeof pattern === 'string'
    ? value.trim().toLowerCase() === pattern.trim().toLowerCase()
    : pattern.test(value);
}

export function matches(matcher: HandlerMatcher, event: WhatsAppEvent): boolean {
  if (matcher.kind === '*') return true;
  if (matcher.kind !== event.kind) return false;

  if (matcher.kind === 'status') {
    return !matcher.statuses || matcher.statuses.includes((event as StatusEvent).status);
  }
  if (matcher.kind === 'message') {
    const message = event as MessageEvent;
    const filter = matcher.filter ?? {};
    if (filter.type !== undefined && ![filter.type].flat().includes(message.type)) return false;
    if (filter.text !== undefined && !matchesPattern(message.text, filter.text)) return false;
    if (filter.replyId !== undefined && !matchesPattern(message.reply?.id, filter.replyId)) return false;
  }
  return true;
}

@Injectable()
export class WhatsAppEventsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('WhatsAppEvents');
  private readonly subject = new Subject<WhatsAppEvent>();
  private readonly handlers: Array<{ matcher: HandlerMatcher; handle: Handler }> = [];

  /** Every verified event, after its handlers finished. */
  readonly events$: Observable<WhatsAppEvent> = this.subject.asObservable();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const wrappers = [...this.discovery.getProviders(), ...this.discovery.getControllers()];
    for (const wrapper of wrappers) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      for (const methodName of this.scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
        const method = instance[methodName];
        if (typeof method !== 'function') continue;
        const matcher = this.reflector.get<HandlerMatcher | undefined>(WHATSAPP_EVENT_HANDLER, method);
        if (!matcher) continue;
        this.on(matcher, (event) => (method as Handler).call(instance, event));
        this.logger.log(`Mapped ${wrapper.name}.${methodName} to WhatsApp ${matcher.kind} events`);
      }
    }
  }

  onMessage(handler: (event: MessageEvent) => unknown, filter?: MessageFilter): () => void {
    return this.on({ kind: 'message', filter }, handler);
  }

  onStatus(handler: (event: StatusEvent) => unknown, statuses?: MessageStatus[]): () => void {
    return this.on({ kind: 'status', statuses }, handler);
  }

  onTemplateStatus(handler: (event: TemplateStatusEvent) => unknown): () => void {
    return this.on({ kind: 'template_status' }, handler);
  }

  /** Programmatic subscription. Returns an unsubscribe function. */
  on(matcher: HandlerMatcher, handle: Handler): () => void {
    const entry = { matcher, handle };
    this.handlers.push(entry);
    return () => {
      const index = this.handlers.indexOf(entry);
      if (index !== -1) this.handlers.splice(index, 1);
    };
  }

  async emit(event: WhatsAppEvent): Promise<void> {
    const matching = this.handlers.filter((entry) => matches(entry.matcher, event));
    await Promise.all(matching.map((entry) => entry.handle(event)));
    this.subject.next(event);
  }
}
