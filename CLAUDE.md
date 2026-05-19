# Rules

1. No assumptions — ask or state tradeoffs.
2. Min code, no speculation.
3. Touch only what's needed.
4. Define success → verify (`pnpm run test`, `pnpm run build`).

---

# allons-api

NestJS · TS · Prisma/Postgres · Supabase auth · Pay: **Paygate** (webhooks + polling/cron). Serves **allons-mobile** (clientes, comercios, staff) and **allons-admin**.

## SOLID + modules

- **S** — controller = HTTP; service = rules; repository = DB/Paygate I/O.
- **O** — extend via new methods/DTOs, not giant `if` chains.
- **L** — interchangeable implementations behind injectable services.
- **I** — narrow service/repository APIs per feature.
- **D** — depend on abstractions (repos, `PaygateClient`), not Prisma in controllers.

**Split fat services:** one feature folder per domain; extract private helpers or sub-services before a file passes ~300 lines.

## Layers

| Where | What |
|-------|------|
| `*.controller.ts` | Routes, guards, DTO validation, status codes |
| `*.service.ts` | Business logic, orchestration |
| `*.repository.ts` | Prisma/raw SQL, idempotent writes |
| `*.module.ts` | Wiring only |
| `prisma/` | Schema + migrations (no ad-hoc DDL in app code) |
| `src/shared/` | Cross-cutting (mail, supabase admin, guards) |

No Paygate/DB logic in controllers. User errors → `BadRequestException`; missing → `NotFoundException`.

## Features (`src/features/`)

`events` · `me` (clientes) · `providers` (comercios) · `payments` · `paygate` · `admin` · `conversations` · `health`

Payments: webhook signs + `resolution_source`; reconciliation cron — see `docs/` in **allons-mobile** (`payments-architecture.md`).

## Do

- New behavior → feature module + tests (`*.spec.ts`) for non-trivial rules.
- Migrations for schema changes; `prisma generate` after schema edits.
- CodeGraph for call graph (`.cursor/rules/codegraph.mdc`); grep for strings/env.
- UTF-8 in messages (`vacío`, not `vac?o`).

## Repos

| Repo | Role |
|------|------|
| **allons-api** | This repo. REST + webhooks + DB. |
| **allons-mobile** | Expo app. `EXPO_PUBLIC_API_URL` → here. |
| **allons-admin** | Ops web; calls admin routes on this API. |

## Don't

- Log full Paygate payloads, secrets, or PII.
- Skip webhook signature verify.
- Business logic in controllers or duplicate queries across services.
- Drive-by refactors or docs the task didn't ask for.
