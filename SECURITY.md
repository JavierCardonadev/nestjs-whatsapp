# Security policy

This library authenticates webhooks and holds access tokens, so vulnerabilities are taken seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting:
[Report a vulnerability](https://github.com/JavierCardonadev/nestjs-whatsapp/security/advisories/new).

Include the version and a proof of concept if possible. You will get an answer within 5 business days.

## Supported versions

The latest minor release receives security fixes.

## Integration checklist

- Create the Nest app with `rawBody: true` and configure `appSecret`; the webhook rejects unsigned requests.
- Use a system user access token stored in a secret manager, with only the permissions you need.
- Make handlers idempotent: Meta retries deliveries that don't get a `200`.
- Treat phone numbers, usernames and message content as personal data (GDPR, LGPD, Ley 1581…): avoid logging payloads.
