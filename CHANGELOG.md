# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-13

### Added

- `WhatsAppClient` for the Cloud API (Graph API v26.0): text, templates (positional and named parameters, headers, dynamic buttons), authentication codes, media, location, reactions, reply buttons, lists, CTA URL buttons, raw payloads and read receipts with typing indicator.
- Recipients by E.164 phone number or business-scoped user id (BSUID).
- Media upload, info, download and delete; template list, create and delete.
- Webhook challenge verification, `X-Hub-Signature-256` validation and normalized message, status, template status and passthrough events, including usernames, Flows responses, pricing and errors.
- `WhatsAppApiError` with Graph error fields and helpers; client-side validation of WhatsApp limits.
- NestJS `WhatsAppModule` (`forRoot`/`forRootAsync`), webhook controller, `WhatsAppEventsService` and `@OnWhatsAppMessage`, `@OnWhatsAppStatus`, `@OnWhatsAppTemplateStatus`, `@OnWhatsAppEvent` decorators.
- Framework-agnostic `nestjs-whatsapp/core` entry point.
