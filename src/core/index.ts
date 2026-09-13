// Framework-agnostic entry point: no NestJS imports.
export * from './types.js';
export * from './errors.js';
export { WhatsAppClient, DEFAULT_API_VERSION } from './client.js';
export {
  authenticationTemplateMessage,
  buttonsMessage,
  ctaUrlMessage,
  isBusinessScopedUserId,
  listMessage,
  locationMessage,
  mediaMessage,
  reactionMessage,
  recipientFields,
  templateMessage,
  textMessage,
  type MessagePayload,
} from './messages.js';
export { parseWebhookPayload, verifyChallenge, verifySignature } from './webhooks.js';
