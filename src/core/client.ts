import {
  WhatsAppApiError,
  WhatsAppConfigurationError,
  WhatsAppValidationError,
  type GraphErrorBody,
} from './errors.js';
import {
  authenticationTemplateMessage,
  buttonsMessage,
  ctaUrlMessage,
  listMessage,
  locationMessage,
  mediaMessage,
  reactionMessage,
  templateMessage,
  textMessage,
  type MessagePayload,
} from './messages.js';
import type {
  CtaUrlMessage,
  DownloadedMedia,
  FetchLike,
  ListMessage,
  Location,
  MediaInfo,
  MediaOptions,
  MediaSource,
  MediaType,
  Recipient,
  ReplyButtonsMessage,
  SendOptions,
  SentMessage,
  TemplateCategory,
  TemplateList,
  TemplateMessage,
  WebhookRequest,
  WhatsAppConfig,
  WhatsAppEvent,
} from './types.js';
import { parseWebhookPayload, verifyChallenge, verifySignature } from './webhooks.js';

export const DEFAULT_API_VERSION = 'v26.0';

interface GraphRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  body?: FormData;
}

/**
 * WhatsApp Cloud API client. Framework-agnostic: works in NestJS, Express, workers or scripts.
 *
 * ```ts
 * const whatsapp = new WhatsAppClient({ accessToken, phoneNumberId });
 * await whatsapp.sendText('+573001234567', 'Your order shipped 📦');
 * ```
 */
export class WhatsAppClient {
  readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly config: WhatsAppConfig) {
    if (!config?.accessToken) throw new WhatsAppConfigurationError('whatsapp: accessToken is required');
    if (!config.phoneNumberId) throw new WhatsAppConfigurationError('whatsapp: phoneNumberId is required');
    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
    if (!/^v\d+\.\d+$/.test(this.apiVersion)) {
      throw new WhatsAppConfigurationError(
        `whatsapp: apiVersion must look like "v26.0"; received "${this.apiVersion}"`,
      );
    }
    this.baseUrl = (config.baseUrl ?? 'https://graph.facebook.com').replace(/\/+$/, '');
    this.fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  get phoneNumberId(): string {
    return this.config.phoneNumberId;
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  /** Free-form text. Only allowed within 24 h of the user's last message; otherwise use a template. */
  sendText(to: Recipient, body: string, options?: SendOptions & { previewUrl?: boolean }): Promise<SentMessage> {
    return this.send(textMessage(to, body, options), options);
  }

  /** Approved template: the only way to start a conversation or write after the 24 h window. */
  sendTemplate(to: Recipient, template: TemplateMessage, options?: SendOptions): Promise<SentMessage> {
    return this.send(templateMessage(to, template, options), options);
  }

  /** One-time passcode with an authentication template (fills the body and the copy-code button). */
  sendAuthenticationCode(
    to: Recipient,
    template: { name: string; language: string },
    code: string,
    options?: SendOptions,
  ): Promise<SentMessage> {
    return this.send(authenticationTemplateMessage(to, template, code, options), options);
  }

  sendMedia(to: Recipient, type: MediaType, source: MediaSource, options?: MediaOptions): Promise<SentMessage> {
    return this.send(mediaMessage(to, type, source, options), options);
  }

  sendImage(to: Recipient, source: MediaSource, options?: MediaOptions): Promise<SentMessage> {
    return this.sendMedia(to, 'image', source, options);
  }

  sendDocument(to: Recipient, source: MediaSource, options?: MediaOptions): Promise<SentMessage> {
    return this.sendMedia(to, 'document', source, options);
  }

  sendVideo(to: Recipient, source: MediaSource, options?: MediaOptions): Promise<SentMessage> {
    return this.sendMedia(to, 'video', source, options);
  }

  sendAudio(to: Recipient, source: MediaSource, options?: SendOptions): Promise<SentMessage> {
    return this.sendMedia(to, 'audio', source, options);
  }

  sendSticker(to: Recipient, source: MediaSource, options?: SendOptions): Promise<SentMessage> {
    return this.sendMedia(to, 'sticker', source, options);
  }

  sendLocation(to: Recipient, location: Location, options?: SendOptions): Promise<SentMessage> {
    return this.send(locationMessage(to, location, options), options);
  }

  /** React to a message. An empty emoji removes the reaction. */
  sendReaction(to: Recipient, messageId: string, emoji: string, options?: SendOptions): Promise<SentMessage> {
    return this.send(reactionMessage(to, messageId, emoji, options), options);
  }

  /** Up to 3 quick-reply buttons. Taps arrive as messages with `reply.id`. */
  sendButtons(to: Recipient, message: ReplyButtonsMessage, options?: SendOptions): Promise<SentMessage> {
    return this.send(buttonsMessage(to, message, options), options);
  }

  /** A menu of up to 10 rows. The selection arrives as a message with `reply.id`. */
  sendList(to: Recipient, message: ListMessage, options?: SendOptions): Promise<SentMessage> {
    return this.send(listMessage(to, message, options), options);
  }

  /** A button that opens a URL, without exposing the raw link. */
  sendCtaUrl(to: Recipient, message: CtaUrlMessage, options?: SendOptions): Promise<SentMessage> {
    return this.send(ctaUrlMessage(to, message, options), options);
  }

  /** Sends any Cloud API message payload (contacts, carousels, flows…). */
  async send(payload: MessagePayload, options: { phoneNumberId?: string } = {}): Promise<SentMessage> {
    const data = await this.request<{
      contacts?: Array<{ input: string; wa_id?: string; user_id?: string }>;
      messages?: Array<{ id: string; message_status?: string }>;
    }>({ method: 'POST', path: `${options.phoneNumberId ?? this.config.phoneNumberId}/messages`, json: payload });

    const contact = data.contacts?.[0];
    const message = data.messages?.[0];
    return {
      id: message?.id ?? '',
      status: message?.message_status,
      recipient: {
        input: contact?.input ?? String(payload.to ?? payload.recipient ?? ''),
        phone: contact?.wa_id,
        userId: contact?.user_id,
      },
      raw: data,
    };
  }

  /** Marks a received message (and the ones before it) as read — blue ticks — and optionally shows "typing…". */
  async markAsRead(messageId: string, options: { typing?: boolean; phoneNumberId?: string } = {}): Promise<void> {
    if (!messageId) throw new WhatsAppValidationError('messageId is required');
    await this.request({
      method: 'POST',
      path: `${options.phoneNumberId ?? this.config.phoneNumberId}/messages`,
      json: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        ...(options.typing ? { typing_indicator: { type: 'text' } } : {}),
      },
    });
  }

  // ─── Media ───────────────────────────────────────────────────────────────

  /** Uploads a file and returns its media id (valid for 30 days). */
  async uploadMedia(
    file: Blob | Uint8Array,
    mimeType: string,
    options: { filename?: string; phoneNumberId?: string } = {},
  ): Promise<string> {
    if (!mimeType) throw new WhatsAppValidationError('mimeType is required');
    const blob = file instanceof Blob ? file : new Blob([file as Uint8Array<ArrayBuffer>], { type: mimeType });
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', blob, options.filename ?? 'file');
    const data = await this.request<{ id: string }>({
      method: 'POST',
      path: `${options.phoneNumberId ?? this.config.phoneNumberId}/media`,
      body: form,
    });
    return data.id;
  }

  async getMedia(mediaId: string): Promise<MediaInfo> {
    const data = await this.request<Record<string, any>>({ method: 'GET', path: encodeURIComponent(mediaId) });
    return {
      id: data.id,
      url: data.url,
      mimeType: data.mime_type,
      sha256: data.sha256,
      fileSize: Number(data.file_size),
    };
  }

  /** Downloads media received in a message (`event.media.id`). */
  async downloadMedia(mediaId: string): Promise<DownloadedMedia> {
    const info = await this.getMedia(mediaId);
    const response = await this.fetchRaw(info.url, { headers: { Authorization: `Bearer ${this.config.accessToken}` } });
    if (!response.ok) {
      throw new WhatsAppApiError(`media download failed with HTTP ${response.status}`, { httpStatus: response.status });
    }
    return { ...info, data: Buffer.from(await response.arrayBuffer()) };
  }

  async deleteMedia(mediaId: string): Promise<void> {
    await this.request({ method: 'DELETE', path: encodeURIComponent(mediaId) });
  }

  // ─── Templates ───────────────────────────────────────────────────────────

  async listTemplates(
    filters: {
      name?: string;
      status?: string;
      category?: TemplateCategory;
      language?: string;
      limit?: number;
      after?: string;
    } = {},
  ): Promise<TemplateList> {
    const data = await this.request<{
      data?: Array<Record<string, any>>;
      paging?: { cursors?: { after?: string }; next?: string };
    }>({
      method: 'GET',
      path: `${this.requireBusinessAccount()}/message_templates`,
      query: { ...filters },
    });
    return {
      templates: (data.data ?? []).map((raw) => ({
        id: raw.id,
        name: raw.name,
        language: raw.language,
        status: raw.status,
        category: raw.category,
        components: raw.components ?? [],
        raw,
      })),
      nextCursor: data.paging?.next ? data.paging.cursors?.after : undefined,
    };
  }

  /** Submits a template for review. Its approval arrives as a `template_status` webhook event. */
  async createTemplate(template: {
    name: string;
    language: string;
    category: TemplateCategory;
    components: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }): Promise<{ id: string; status: string; category: string }> {
    if (!/^[a-z0-9_]{1,512}$/.test(template?.name ?? '')) {
      throw new WhatsAppValidationError('template name must use lowercase letters, numbers and underscores');
    }
    return this.request({ method: 'POST', path: `${this.requireBusinessAccount()}/message_templates`, json: template });
  }

  /** Deletes every language of a template, or only the one with `templateId`. */
  async deleteTemplate(name: string, options: { templateId?: string } = {}): Promise<void> {
    await this.request({
      method: 'DELETE',
      path: `${this.requireBusinessAccount()}/message_templates`,
      query: { name, hsm_id: options.templateId },
    });
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────

  /** Answers Meta's `GET` verification request. Returns the challenge to echo back. */
  verifyWebhookChallenge(query: Record<string, unknown>): string {
    return verifyChallenge(query, this.config.verifyToken);
  }

  /** Verifies `X-Hub-Signature-256` and returns one normalized event per message, status or change. */
  parseWebhook(request: WebhookRequest): WhatsAppEvent[] {
    verifySignature(request, this.config.appSecret);
    return parseWebhookPayload(request.rawBody);
  }

  // ─── HTTP ────────────────────────────────────────────────────────────────

  private requireBusinessAccount(): string {
    if (!this.config.businessAccountId) {
      throw new WhatsAppConfigurationError('whatsapp: businessAccountId is required for template management');
    }
    return this.config.businessAccountId;
  }

  private async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (cause) {
      throw new WhatsAppApiError(`network error calling ${new URL(url).pathname}`, { cause });
    }
  }

  private async request<T = unknown>(req: GraphRequest): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.apiVersion}/${req.path}`);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.accessToken}` };
    let body: string | FormData | undefined = req.body;
    if (req.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.json);
    }

    const response = await this.fetchRaw(url.toString(), { method: req.method, headers, body });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const error = (data as { error?: GraphErrorBody } | undefined)?.error;
      throw new WhatsAppApiError(
        error?.message
          ? `${error.message}${error.code !== undefined ? ` (#${error.code})` : ''}`
          : `${req.method} ${url.pathname} failed with HTTP ${response.status}`,
        { httpStatus: response.status, error, raw: data },
      );
    }
    return data as T;
  }
}
