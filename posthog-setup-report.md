<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Allons API. A new `PostHogService` was added to the global `SharedModule`, making it injectable across all feature modules without additional configuration. The `posthog-node` SDK is initialized with `enableExceptionAutocapture: true` and shuts down cleanly via `OnApplicationShutdown`. Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` are referenced via `.env`.

User identification is triggered on every `GET /me` call, ensuring all subsequent server-side events are tied to the correct person profile. Exception capture is wired into the ticket purchase error path. Events are tracked across six files covering the full customer journey — from social engagement and free ticket claims, through paid checkout and payment resolution, to provider-side event management and churn signals.

| Event | Description | File |
|---|---|---|
| `ticket purchased` | User successfully creates a free ticket for an event | `src/features/me/me.controller.ts` |
| `ticket cancelled` | User cancels one of their tickets | `src/features/me/me.controller.ts` |
| `ticket shared` | User shares a ticket with another user in-app | `src/features/me/me.controller.ts` |
| `ticket invite sent` | User invites someone via email to receive a ticket | `src/features/me/me.controller.ts` |
| `ticket invite accepted` | User accepts a ticket invitation | `src/features/me/me.controller.ts` |
| `payment initiated` | User starts a paid checkout for an event ticket | `src/features/payments/me-payments.controller.ts` |
| `payment completed` | Payment order transitions to paid (via webhook or polling) | `src/features/paygate/paygate.webhook.controller.ts` |
| `payment failed` | Payment order transitions to failed or cancelled | `src/features/paygate/paygate.webhook.controller.ts` |
| `friend added` | User adds another user as a friend / follows | `src/features/friends/friends.controller.ts` |
| `friend removed` | User removes a friend connection | `src/features/friends/friends.controller.ts` |
| `account deleted` | User requests account deletion (account is banned) | `src/features/account/account.controller.ts` |
| `provider event created` | Organizer (provider) creates a new event | `src/features/providers/provider-private.controller.ts` |
| `provider event deleted` | Organizer deletes an event | `src/features/providers/provider-private.controller.ts` |
| `payout requested` | Provider requests a payout of their balance | `src/features/providers/provider-private.controller.ts` |
| `ticket scan validated` | Staff validates a ticket scan at the event entrance | `src/features/providers/provider-private.controller.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1602435)
- [Payment conversion funnel](/insights/mTkIXKD6) — Conversion rate from `payment initiated` → `payment completed`
- [Ticket & payment activity](/insights/WrXhPlel) — Daily volume of free and paid ticket acquisitions
- [Churn signals](/insights/NoCe265D) — Ticket cancellations and account deletions over time
- [Provider event creation](/insights/y5AJeTVy) — Organizer activity: new events published per day
- [Social engagement](/insights/NjPebN6R) — Friend adds, ticket shares, and invites sent

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
