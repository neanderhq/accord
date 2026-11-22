# Accord operations

Each deployment owns its staff accounts, PostgreSQL database, verified email sender, webhook endpoints and external scheduler. No delivered production credentials or jobs are shipped.

## Email, signing links and jobs

Configure your own Resend (`RESEND_API_KEY`) or Brevo (`BREVO_API_KEY`) credentials, `EMAIL_FROM`, and `EMAIL_DISPATCH_ENABLED=1`. Resend takes precedence when configured. Signing requests, reminders, reissued links, completion copies, invitations and recovery use the Accord HTML layout with plain-text fallback. `.test` addresses are blocked from real delivery. Provider acceptance is not proof of inbox arrival.

An in-app timer runs while the process has CPU. For idle/scale-to-zero deployments, configure your scheduler to POST `/api/jobs/tick` every 30 minutes with a bearer `JOB_TICK_SECRET` of at least 32 characters, stored in that scheduler's secret facility. Expiry and retention also require scheduled ticks. The template creates no external jobs. Settings & integrations shows job and delivery outcomes. Uncertain deliveries require provider reconciliation before resending.

## Webhooks

Enable `WEBHOOK_DISPATCH_ENABLED=1` only after configuring your company's public HTTPS endpoint and 32+ character signing secret in Settings & integrations. Deliveries include `x-esign-id`, `x-esign-timestamp` and `x-esign-signature` (HMAC-SHA256 of timestamp + `.` + raw body). Deduplicate event IDs and check timestamp/signature in your receiver. Private/loopback destinations are refused.

## Recovery

Company admins can download a recovery export containing their records and document bytes. Keep exports private: they can contain personal information and signed documents. Passwords, sessions and platform configuration are excluded. `pnpm recovery:verify` performs the existing development-only export/restore drill on an explicitly approved local database; do not use it on production.

Managed database retention and point-in-time recovery require the database/platform owner. Restore to a separate branch/database, compare documents, digests, envelope states and audit records, and only then plan any production switch. Never test by resetting live state or editing immutable evidence.

## DOCX

See the README's conversion limits. PDF is the supported input for preserving precise source presentation; bounded DOCX conversion does not imply complete Word formatting fidelity.
