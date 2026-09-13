export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WhatsAppConfig {
  /** System user access token with `whatsapp_business_messaging` (and `whatsapp_business_management` for templates). */
  accessToken: string;
  /** Default sender. Can be overridden per message with `phoneNumberId`. */
  phoneNumberId: string;
  /** WhatsApp Business Account id. Required for template management. */
  businessAccountId?: string;
  /** App secret, used to verify `X-Hub-Signature-256` on webhooks. */
  appSecret?: string;
  /** The token you typed when configuring the webhook in the App Dashboard. */
  verifyToken?: string;
  /** Graph API version. Default `v26.0`. */
  apiVersion?: string;
  /** Default `https://graph.facebook.com`. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Per-request timeout. Default 15 000 ms. */
  timeoutMs?: number;
}

/** An E.164 phone number (`+573001234567`) or a business-scoped user id (`CO.1234567890`). */
export type Recipient = string;

export interface SendOptions {
  /** Reply to (quote) a message. */
  replyTo?: string;
  /** Send from another number of the same app. */
  phoneNumberId?: string;
  /** Echoed back in status webhooks as `bizOpaqueCallbackData`. Max 512 chars. */
  callbackData?: string;
}

export type MediaSource = { id: string } | { link: string };

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export interface MediaOptions extends SendOptions {
  /** Not supported for audio and stickers. */
  caption?: string;
  /** Documents only. */
  filename?: string;
}

export interface Location {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export type TemplateParameter =
  | string
  | number
  | { type: 'text'; text: string; parameter_name?: string }
  | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: 'date_time'; date_time: { fallback_value: string } };

export type TemplateHeader =
  | { type: 'text'; text: string; parameterName?: string }
  | { type: 'image' | 'video'; media: MediaSource }
  | { type: 'document'; media: MediaSource; filename?: string }
  | { type: 'location'; location: Location };

export type TemplateButton =
  | { type: 'url'; text: string; index?: number }
  | { type: 'quick_reply'; payload: string; index?: number }
  | { type: 'copy_code'; code: string; index?: number };

export interface TemplateMessage {
  name: string;
  /** Template language code, e.g. `es`, `es_MX`, `pt_BR`, `en_US`. */
  language: string;
  header?: TemplateHeader;
  /** Positional (`['Ana', '#123']`) or named (`{ first_name: 'Ana' }`) body parameters. */
  body?: TemplateParameter[] | Record<string, string | number>;
  /** Parameters for dynamic buttons, in button order unless `index` is set. */
  buttons?: TemplateButton[];
  /** Raw components, appended as-is (carousels, limited-time offers…). */
  components?: Array<Record<string, unknown>>;
}

export type InteractiveHeader =
  { type: 'text'; text: string } | { type: 'image' | 'video' | 'document'; media: MediaSource };

export interface ReplyButtonsMessage {
  body: string;
  /** 1–3 buttons. Titles up to 20 characters, ids up to 256. */
  buttons: Array<{ id: string; title: string }>;
  header?: InteractiveHeader;
  footer?: string;
}

export interface ListMessage {
  body: string;
  /** Text of the button that opens the list (max 20 characters). */
  button: string;
  /** Up to 10 sections and 10 rows in total. */
  sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  header?: { type: 'text'; text: string };
  footer?: string;
}

export interface CtaUrlMessage {
  body: string;
  displayText: string;
  url: string;
  header?: InteractiveHeader;
  footer?: string;
}

export interface SentMessage {
  /** `wamid.…` — matches `messageId` in status events. */
  id: string;
  /** `accepted`, `held_for_quality_assessment` or `paused` (marketing templates). */
  status?: string;
  recipient: { input: string; phone?: string; userId?: string };
  raw: unknown;
}

export interface MediaInfo {
  id: string;
  /** Short-lived download URL (requires the access token). */
  url: string;
  mimeType: string;
  sha256: string;
  fileSize: number;
}

export interface DownloadedMedia extends MediaInfo {
  data: Buffer;
}

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';

export interface Template {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  components: Array<Record<string, unknown>>;
  raw: unknown;
}

export interface TemplateList {
  templates: Template[];
  /** Pass as `after` to get the next page. */
  nextCursor?: string;
}

// ─── Webhook events ────────────────────────────────────────────────────────

export interface WhatsAppUser {
  /** E.164 digits without `+`. Omitted for users with a username you haven't talked to recently. */
  phone?: string;
  /** Business-scoped user id (BSUID), e.g. `CO.13491208655302741918`. Always present on incoming messages since 2026. */
  userId?: string;
  parentUserId?: string;
  name?: string;
  username?: string;
}

interface EventBase {
  /** WhatsApp Business Account id. */
  businessAccountId: string;
  /** Receiving/sending business number. */
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  timestamp?: Date;
  raw: unknown;
}

export type IncomingMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'reaction'
  | 'order'
  | 'system'
  | 'request_welcome'
  | 'unsupported'
  | (string & {});

export interface IncomingMedia {
  id: string;
  mimeType?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  /** Voice note (audio recorded in WhatsApp). */
  voice?: boolean;
  animated?: boolean;
}

export interface MessageEvent extends EventBase {
  kind: 'message';
  /** `wamid.…`. Use it to deduplicate retries and to `markAsRead`/reply. */
  id: string;
  from: WhatsAppUser;
  type: IncomingMessageType;
  /**
   * The human-readable content: text body, media caption, the title of a tapped
   * button or list row, or the text of a template quick reply.
   */
  text?: string;
  /** Button or list row the user tapped (`id` is the one you set, or the template button payload). */
  reply?: { id: string; title?: string; description?: string };
  /** Submitted WhatsApp Flow: the flow name and the parsed `response_json`. */
  flow?: { name?: string; response: Record<string, unknown> };
  media?: IncomingMedia;
  location?: Location & { url?: string };
  reaction?: { messageId: string; emoji?: string };
  /** The message this one replies to or was forwarded from. */
  context?: { messageId?: string; from?: string; forwarded?: boolean; frequentlyForwarded?: boolean };
  /** Ad or post that started the conversation (click-to-WhatsApp). */
  referral?: Record<string, unknown>;
  errors?: WhatsAppEventError[];
}

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'played' | 'failed' | (string & {});

export interface WhatsAppEventError {
  code: number;
  title?: string;
  message?: string;
  details?: string;
}

export interface StatusEvent extends EventBase {
  kind: 'status';
  /** The `SentMessage.id` this status belongs to. */
  messageId: string;
  status: MessageStatus;
  recipient: WhatsAppUser;
  conversation?: { id: string; originType?: string; expiresAt?: Date };
  pricing?: { category?: string; model?: string; type?: string; billable?: boolean };
  callbackData?: string;
  errors?: WhatsAppEventError[];
}

export interface TemplateStatusEvent extends EventBase {
  kind: 'template_status';
  /** `APPROVED`, `REJECTED`, `PAUSED`, `DISABLED`, `PENDING_DELETION`… */
  event: string;
  templateId: string;
  templateName: string;
  language?: string;
  reason?: string;
}

/** Any other webhook field (account updates, quality changes…), passed through untouched. */
export interface OtherEvent extends EventBase {
  kind: 'other';
  field: string;
  value: unknown;
}

export type WhatsAppEvent = MessageEvent | StatusEvent | TemplateStatusEvent | OtherEvent;

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** The exact bytes received. */
  rawBody: Buffer | string;
}
