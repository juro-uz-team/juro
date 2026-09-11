# Server-side secrets

No secret values belong in Git, documentation, screenshots, browser bundles, logs or chat. Model names are ordinary server variables, not secrets.

## Verified staging bindings

Wrangler returned the following secret names for `juro-platform-staging` on 2026-08-04; values were neither read nor printed:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `TURNSTILE_SECRET_KEY`
- `IDENTITY_KEYRING`
- `PAYMENT_SANDBOX_WEBHOOK_SECRET`

`IDENTITY_KEYRING` is the current versioned key contract for AES-GCM protection and HMAC lookups used by identity, MFA, memory, deletion evidence, guest AI and voice transcripts. It consolidates cryptographic operations that the original objective described with several standalone secret names. Adding parallel `ENCRYPTION_KEY`, `OTP_HASH_SECRET`, `TOTP_ENCRYPTION_KEY` or `SIGNED_URL_SECRET` values without code consumers would create misleading security configuration, so they are not claimed as configured.

The current opaque server-side session design does not consume a `SESSION_SECRET`, and scheduled events use Cloudflare Cron rather than a public `CRON_SECRET` endpoint. If these contracts change, the new secret must be introduced with an actual consumer, rotation plan and tests before staging configuration changes.

## Non-secret model configuration

- `OPENAI_CHAT_MODEL=gpt-5.6-luna`
- `OPENAI_DEEP_MODEL=gpt-5.6-terra`
- `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe`
- `OPENAI_TTS_MODEL=gpt-4o-mini-tts`
- `ANTHROPIC_DOCUMENT_MODEL=claude-sonnet-4-6`
- `ANTHROPIC_FALLBACK_MODEL=claude-sonnet-4-6`
- `EMBEDDING_MODEL=text-embedding-3-large`

The artifact validator rejects credential bindings from Wrangler `vars`, including both current and objective-named secrets. A diff secret scan must run before every commit and deploy. Key rotation is performed interactively with Wrangler or the Cloudflare dashboard; secret values are never requested in chat.
