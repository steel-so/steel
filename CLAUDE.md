# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Steel** is Stratus Telecom's multi-tenant platform that bundles **ServiceDesk**, **CRM** and **Comunicação (WhatsApp Business)** in one workspace. It was bootstrapped from the **Nexo** base (project management) — auth, workspaces, billing, status page, e-mails and the layered architecture come from there; the CRM and WhatsApp modules are built on top. Stack: Next.js 16 (App Router), PostgreSQL 17 / Prisma 7, Redis 8 (TLS), BullMQ, MinIO (S3), Better Auth, Axiom. Package manager is **pnpm**. License is proprietary.

## Working mode (MUST follow)

Act as a **code assistant**: deliver the code to write directly in the text of your reply (fenced blocks + explanation). Only modify, create, or delete a file when the user **explicitly asks** for that file change in the current message. A general task description is not standing permission to touch the filesystem — do not call Edit/Write or mutating Bash commands without an explicit request.

## Project docs

Documentation lives **in this repo** under `docs/` (pt-BR with EN technical terms):

- `docs/architecture/overview.md` — macro architecture (layers, modules, worker queues, infra, backups, delivery). Start here.
- `docs/adr/` — Architecture Decision Records (trunk-based `main`, `Result` type, CalVer, status collection via worker, self-hosted runner, AI assistant/provider policy). New decisions get a new ADR from `docs/adr/template.md`; never rewrite an accepted one.
- `docs/runbooks/` — step-by-step operations for the IT team (health check, restart a service, restore a backup, red CI / failed deploy). Keep them in sync when infra or scripts change.
- `docs/plans-review.md` — current plan limits, where they are enforced, and open decisions.

## Commands

```bash
pnpm dev                  # start infra (docker + migrations) then `next dev` on :3001
pnpm infra                # docker:start + prisma:migrate:dev (no dev server)
pnpm docker:create        # first run only — create & start infra containers
pnpm build                # prisma generate + next build
pnpm start                # roda a build standalone (node .next/standalone/server.js)
pnpm start:dev-server     # next start on :3001 — só para e2e local; `next start` não serve a build standalone
pnpm check                # biome check --fix (lint + format + organize imports)
pnpm check:ci             # biome check, no writes (use this to verify CI will pass)
pnpm version:sync [tag]   # stamp package.json/openapi.json from a CalVer tag (ADR 0003)
```

**Ports:** local app **3001**, React Email preview **3002**. Port **3000** is only the production container (behind nginx) and is reserved for another project on the dev machine — never bind to it locally.

### Tests (Vitest — projects in `vite.config.ts`)

```bash
pnpm test:unit            # services, mappers, schemas, errors, lib/utils — node, fast, mocked
pnpm test:integration     # repositories + cache — hits a real Postgres + Redis (serial, forks)
pnpm test:e2e             # app/**/__tests__/*.e2e.test.ts — runs against `next start` (BASE_URL defaults to :3001)
pnpm test:component       # app/**/__tests__/*.component.test.tsx — jsdom
pnpm test:all             # every project, --run
pnpm test:coverage        # unit + integration with coverage (95% floor on all 4 metrics)
pnpm test:ui              # Vitest UI (browser): every project, on :51204
pnpm test:ui:coverage     # same, with the coverage tab

# single test:
pnpm vitest --project unit src/services/__tests__/sticky-note.service.test.ts
pnpm vitest --project unit -t "creates a sticky note"   # by test name
```

Test file location determines which project runs it (see `include` globs in `vite.config.ts`), so place new tests accordingly:
- `*.test.ts` under `src/services|mappers|schemas|errors`, `src/lib/__tests__`, `lib/__tests__`, `utils/__tests__` → **unit** (worker processors are unit-tested here with mocks, e.g. `src/lib/__tests__/status-collect-processor.test.ts`)
- `*.test.ts` under `src/repositories|cache` and `*.integration.test.ts` under `src/lib` → **integration** (needs DB/Redis up via `pnpm infra`)
- `app/**/__tests__/*.e2e.test.ts` → **e2e**; `app/**/__tests__/*.component.test.tsx` → **component**
- `src/lib/__tests__/*.smoke.test.ts` → **redis-tls** smoke
- Integration tests truncate all tables `afterEach` (`src/__tests__/setup.integration.ts`), so they require a disposable dev database.

**Vitest UI** (`@vitest/ui`, pinned to the exact `vitest` version — they must match): filterable test tree, diffs, module graph and the coverage report at `http://localhost:51204/__vitest__/`. `pnpm test:ui` runs **every** project, so it needs the infra up (`pnpm infra`) for integration and `pnpm start` on :3001 for e2e; as usual those two TRUNCATE the dev database between tests.


### Worker (BullMQ background jobs — separate process from Next)

```bash
pnpm worker:dev           # tsx watch worker/index.ts
pnpm worker:build         # esbuild bundle → dist/worker.cjs
pnpm worker               # run the built bundle
```

### Backups & scripts

```bash
pnpm backup:full                       # enqueue a FULL backup now (worker runs pg_dump)
pnpm backup:workspace <idOrSlug>       # enqueue a single-workspace backup
pnpm restore:full <backupId> [--target=<dbUrl>]          # restore from local MinIO
pnpm restore:full --list-offsite                         # list off-site copies
pnpm restore:full <backupId> --offsite [--target=<dbUrl>] # restore from the off-site copy
pnpm restore:workspace <backupId>
pnpm seed:crm-pipeline | seed:whatsapp-dashboards | seed:user-timezone   # backfills
pnpm seed:dev                          # local only: verified users, workspace /demo with all modules, a zap team (password Steel@dev2026)
```

### Other

```bash
pnpm prisma:studio        # browse the DB
pnpm prisma:migrate:dev   # create/apply a migration in dev
pnpm email                # preview React Email templates (components/emails) on :3002
```

## Architecture

See `docs/architecture/overview.md` for the full picture; the essentials:

### Layered request flow

API routes are thin; business logic lives in services, data access in repositories. The chain for a typical endpoint:

```
app/api/**/route.ts  →  Service  →  Repository  →  Prisma
   (withAxiom)          (Result)     (Result)
```

A route handler (`app/api/sticky-notes/route.ts` is the canonical example) always:
1. wraps the handler in `withAxiom` (from `lib/axiom/server`) for logging,
2. resolves the session via `getAuthSession()` — returns a `Result`, bail with `handleError` on `!ok`,
3. consumes a rate limiter (`consume(apiLimiter, \`user:${id}\`)`),
4. validates the body with a Zod schema (`safeParse`, return `standardError('VALIDATION_ERROR', ...)` on failure),
5. calls the service and returns `successResponse(...)` or `handleError(result.error)`.

### Result type — no thrown errors across layers

Services and repositories never throw; they return `Result<T, AppError>` (`src/lib/result.ts`: `ok(value)` / `err(error)`). Repositories wrap Prisma calls in try/catch and return `err(databaseError(...))` or `err(notFound(...))`. Callers narrow with `if (!result.ok) return result`. This propagates cleanly up to the route, where `handleError` maps the `AppError` to an HTTP response (ADR 0002).

`AppError` (`src/errors/app-error.ts`) is a plain object with a `code` from the central `ERROR_CODES` registry (`src/errors/codes.ts`), which is the single source of truth mapping each code to an HTTP status. Construct errors with the factory helpers (`unauthorized()`, `forbidden()`, `notFound('Resource')`, `validationError()`, `rateLimited()`, etc.) — do not invent new codes inline; add them to `codes.ts` first.

HTTP envelope helpers live in `utils/http-response.ts`: `successResponse`, `errorResponse`, `standardError` (by `ErrorCode`), and `handleError` (by `AppError`, also sets `Retry-After` for rate limits). All responses use the `{ success, statusCode, data | error }` shape from `types/http-response`.

### The per-layer files for an entity

Each domain entity has a parallel file in each layer:
- `src/schemas/*.schema.ts` — Zod input schemas + inferred DTO types
- `src/services/*.service.ts` — business rules, authorization checks, audit logging
- `src/repositories/*.repository.ts` — Prisma access, returns `Result`
- `src/mappers/*.mapper.ts` — Prisma model → API DTO (`toXDTO`)
- `src/cache/*.cache.ts` — Redis read-through caching (workspace, user, user-preference, notification-setting, status)

Services own authorization (ownership checks like `value.userId !== actorId → err(forbidden())`, workspace role via `src/services/authz.ts` / `src/lib/permissions.ts`) and emit audit events via `auditMutation` / `auditAuth` from `lib/axiom/audit`.

### Domains

- **Base (from Nexo):** user, workspace, membership, invitation, subscription/coupon (AbacatePay — behind `BILLING_ENABLED`, off by default: `isBillingEnabled()` in `src/lib/billing.ts`), sticky-note, short-link, project, wiki, changelog, talk-to-sales, consent, status.
- **CRM** (`src/services/crm-*.service.ts`, UI `app/(private)/[workspace-slug]/crm/*`, public/integration APIs under `app/api/crm/*`): leads (with pipeline/stage gating, scoring and routing rules), people, companies, opportunities, pipelines, proposals + templates, products, forecast, quotas, tasks, notes, activities, custom fields, reports, dashboards, e-mail campaigns/templates/sync, mailing lists, landing pages, forms, workflows, integration keys, competitors, social (Facebook/Instagram/TikTok/X/LinkedIn/YouTube/Google Ads/Analytics) and the CRM AI assistant (OpenAI or Anthropic per workspace settings, with a monthly usage quota — ADR 0007, `src/lib/ai/`).
- **Comunicação / WhatsApp** (`src/services/whatsapp-*.service.ts`, `src/lib/whatsapp/*`, UI `app/(private)/[workspace-slug]/zap/*`): connections (Meta Cloud API and Z-API), conversations, messages, contacts, groups, templates, quick replies, broadcasts (+ CSV import), dashboards, AI config + knowledge documents, AI auto-reply and sentiment. Webhooks at `app/api/whatsapp/webhook/{meta,zapi}`; realtime via SSE `app/api/whatsapp/events` over Redis pub/sub (`src/lib/whatsapp/realtime.ts`).
- **ServiceDesk (ITIL 4)** (`src/services/sd-*.service.ts` + `SdTicketEngine`, `src/lib/servicedesk/*`, UI `app/(private)/[workspace-slug]/servicedesk/*`, API `app/api/workspaces/[id]/servicedesk/**` and the public approval link `app/api/servicedesk/approvals/[token]`): tickets for the four practices (incident, service request, change, problem) with configurable phases (% complete, transitions, SLA pause), impact × urgency priority matrix, severities, catalog (category > subcategory > service), SLA/OLA over business calendars, escalation and automation rules, custom fields, templates, CMDB, customers/companies/contacts, knowledge base (Plate editor), chat/history with attachments, tasks, costs, parts, e-mail approvals, digital signature, traceability, WhatsApp inside the ticket, AI copilot/pre-service/triage, dashboards (+ TV mode) and the requester portal. Também: **relatórios de SLA agendados** (PDF/CSV no MinIO, envio para destinatários configuráveis), **KCS** (artigo a partir do chamado com rascunho da IA, revisão, validade e métrica de reuso), **risco preditivo** (heurística explicável, ADR 0016) e **integrações Slack/GitHub**. Filas: `servicedesk-{sla,ai,mail,digest,recurring,billing,reports,risk,integrations,task-reminders}`. **Cor do módulo vem só de `app/_components/servicedesk/sd-tone.ts`** — `SD_TONE`, `SD_TONE_SOFT`, `SD_TONE_TEXT`, `SD_TONE_FILL`; nenhuma tela monta `bg-<cor>-500/10` por conta própria, e o resto usa token semântico. See `docs/servicedesk/README.md` and ADR 0008.

### Module access (multi-tenancy)

Everything is scoped by workspace (slug in the URL). Modules (`enum ModuleKind`: `SERVICE_DESK`, `CRM`, `COMMUNICATION`) are enabled per workspace by `WorkspaceModuleAccessService`; each module layout calls `hasModuleAccess(slug, module)` (`src/lib/module-access-guard.ts`) and must call `notFound()` **directly in the layout/page body** (not inside a helper — Cache Components won't see it). A workspace can point a module at its own external Postgres (`WorkspaceModuleConnection`, credentials encrypted with `CONNECTION_SECRETS`, resolved by `src/lib/module-db/resolver.ts`). Plan limits live in `src/config/plans.ts` (only `seats` is enforced today — see `docs/plans-review.md`).

### Auth

Better Auth (`src/lib/auth.ts`) with the Prisma adapter, argon2 hashing, email+password, Google/GitHub OAuth, email-OTP and two-factor plugins. IDs are cuid2. Lifecycle hooks (`sendResetPassword`, `afterEmailVerification`, etc.) trigger transactional emails and audit logging. `getAuthSession()` (`src/lib/auth-session.ts`) is the server-side accessor that returns a `Result`.

Second factor has two methods: **OTP por e-mail** e **TOTP** (app autenticador, com QR, chave manual e 10 códigos de recuperação). `users.two_factor_totp_enabled` marca quem confirmou o app — o `twoFactorEnabled` do plugin é um interruptor único e não distingue método; a tela de login escolhe a etapa por uma dica em `localStorage`, para quem usa app não receber e-mail inútil.

The app runs **its own Redis-backed rate limiting** (`src/lib/rate-limit.ts`) on auth routes; Better Auth's built-in limiter is enabled only in production and disabled when `DISABLE_AUTH_RATE_LIMIT=true` (set during e2e, which runs `next start` in production mode). `MAIL_DRY_RUN=true` stops all Resend sends.

### Observabilidade

Três ferramentas, com papéis distintos: **Axiom** (log estruturado, auditoria LGPD e o painel de analytics do admin), **Sentry** (erro no servidor, no edge e no cliente — `instrumentation.ts`, `instrumentation-client.ts`, `sentry.{server,edge}.config.ts`) e **PostHog** (produto). Os dois últimos entram pelo cookie-consent (`app/_components/user/cookie-consent/`), então nada carrega sem consentimento, e ficam **inertes sem chave** — um deploy sem DSN sobe igual.

`NEXT_PUBLIC_SENTRY_DSN` e `NEXT_PUBLIC_POSTHOG_KEY` são resolvidas em **build time**: precisam estar nos **GitHub Secrets** e nos build-args do `Dockerfile`/`cd.yml`, não só no `.env` do servidor — senão chegam ao servidor e à CSP mas não ao navegador. O PostHog não adiciona origem à CSP (rewrite `/ingest` de mesma origem); o Sentry adiciona uma, derivada do DSN; o Google Analytics é liberado nominalmente quando há `NEXT_PUBLIC_GA_ID`. Ver ADR 0017.

### Request middleware — `proxy.ts`

`proxy.ts` (not `middleware.ts`) is the edge entry point. It injects a per-request CSP nonce (`x-nonce` header), sets security headers (CSP, HSTS), logs via Axiom, and gates auth: routes in `PUBLIC_ROUTES` pass through; otherwise it checks the `better-auth.session_token` cookie and either 401s (for `/api/*`) or redirects to `/sign-in`. Additional static-asset security headers are set in `next.config.ts`.

### Background jobs (BullMQ + Redis)

The worker (`worker/index.ts`) is a standalone Node process (same Docker image, container `steel-worker`, `node dist/worker.cjs`). It registers one BullMQ `Worker` per queue and schedules repeatable jobs on boot (`src/lib/queue/scheduler.ts`, crons in `src/lib/queue/retention.ts`, timezone `America/Sao_Paulo`).
- Queue names & typed job payloads: `src/lib/queue/jobs.ts`
- Queue singletons (lazy, shared `defaultJobOptions` — 3 attempts, exponential backoff): `src/lib/queue/queues.ts`
- Processors (`src/lib/queue/processors/`): `data-retention` (03:00 cleanup of sessions/tokens/invitations), `account-lifecycle` (scheduled account deletion), `data-export` (LGPD export), `trial-lifecycle` (hourly trial revert), `whatsapp-media`, `whatsapp-ai-reply`, `whatsapp-sentiment`, `whatsapp-broadcast` (+ 5-min schedule tick), `crm-scheduled-send` (5 min), `crm-workflow-schedule` (1 min), `crm-competitor-sync` (04:00), `crm-proposal-expiry` (00:05 — expires overdue proposals, e-mails the owner), `crm-social-posts-tick` (1 min), `crm-social-publish` (interactive large-media publish, no retry), `changelog`, `database-backup` (FULL 03:15, prune 03:30, per-workspace, `copy-to-offsite`), `status-collect` (core 1 min, peripheral 5 min — ADR 0004).
- Queue dashboard: `/jobs` (Workbench, basic auth `WORKBENCH_USER`/`WORKBENCH_PASS`).
- The worker imports server-only modules via a shim (`worker/server-only.shim.ts`) since it runs outside Next; the build aliases `server-only` to it (and `tsconfig.worker.json` maps it for `tsx` scripts).

### Backups

Daily FULL `pg_dump` (03:15), app-encrypted with `CONNECTION_SECRETS`, stored in MinIO bucket `database-backups`, tracked in the `backups` table, 90-day retention. Each FULL is then copied off-server by `copy-to-offsite` to an S3-compatible remote (`BACKUP_OFFSITE_*`, SSE + read-back verification, own retention); inert with a warning log when not configured (`src/lib/storage/offsite-backup.ts`). Restore procedures: `docs/runbooks/restore-backup.md`.

### Status page

`/status` is backed by proactive probes (`src/services/status/probes.ts`, `components.ts`) across seven components (app, database, cache, auth, payment — only while billing is on —, email, storage/MinIO), persisted to `HealthCheck` / `ComponentDaily` and surfaced with incident timelines. The worker collects them on a schedule; `POST /api/status/collect/{core,peripheral}` (header `x-status-secret`) stays for manual triggers. From the worker, the app probe hits `STATUS_APP_PROBE_URL` (fallback `BETTER_AUTH_URL`).

### App Router layout

`app/(public)` (sign-in/up, status, legal), `app/(web)` (marketing: pricing, marketplace, talk-to-sales; the user manual at `/docs` from `content/docs/**/*.mdx`; the developer site at `/dev`), `app/(private)/[workspace-slug]` (workspace-scoped UI: home, crm, zap, servicedesk, wiki, ai, settings), `app/onboarding`, `app/upgrade`, `app/jobs` (queue dashboard) and `app/api/**`. Shared UI in `app/_components` and `components/` (shadcn/Base UI). API reference is rendered with Scalar at `/dev/api` from `public/openapi.json` (admin routes stripped; `/reference` redirects there).

## Infrastructure

| Service | Container | Host port | Notes |
| ------- | --------- | --------- | ----- |
| PostgreSQL 17 | `steel-db` | 5433 | `docker-compose.infra.yml`, volume `pgdata` |
| Redis 8 (TLS) | `steel-redis` | 6380 | bitnami pinned by digest (do not switch to `:latest`); certs in `redis-tls/`; URL is `rediss://` |
| MinIO | `steel-minio` | 127.0.0.1:9002 (API), 127.0.0.1:9003 (console) | image `docker.io/pgsty/silo` (maintained AGPL fork of MinIO — the upstream image was withdrawn); API never public (nginx proxies `/media/`) |
| App | `nextjs-app`, `steel-app-2`, `steel-app-3` | 3000, 127.0.0.1:3001-3002 | replicas in `docker-compose.yml` on the server (`/var/www/steel`), behind nginx's `steel_app` upstream (`infra/nginx/`), rolled one at a time by `scripts/deploy.sh`; `'use cache'` tags shared through Redis (`lib/next-cache/`) — ADR 0037 |
| Worker | `steel-worker` | — | same image, `node dist/worker.cjs` |

All on the Docker network `steel_default`. Secrets are SOPS-encrypted (age recipient in `.sops.yaml`, private key only in the `SOPS_AGE_KEY` GitHub secret) and decrypted into `/var/www/steel/.env` at deploy time: `secrets/homologacao.enc.env` by `cd.yml` (homologação) and `secrets/production.enc.env` by `promote-production.yml`. **The production file does not exist yet**, so a promotion to production fails its own pre-check — create it before the first promotion.

## Creating a new feature

Vertical-slice features follow a fixed, three-block order — **SDD → TDD → Code**. The block sequence never changes; some phases collapse when the domain is trivial. Key rules:

- **Block 1 — SDD (contract first).** Design the public contract before any implementation: (0) domain contract bullets (fields, invariants, ownership scope, pagination, domain errors, LGPD sensitivity) → (1) Zod schema in `src/schemas/<feature>.schema.ts` (`Create`/`Update`/output) → (2) Prisma model + migration (`pnpm prisma migrate dev --name <slug>`) → (3) specific error codes in `src/errors/codes.ts` (`<FEATURE>_NOT_FOUND`, `_FORBIDDEN`, `_LIMIT_REACHED`). Zod first, Prisma second — decide what the API exposes before how it's stored. Only the schema tests go green in this block; the schema *is* the code.
- **Block 2 — TDD (all tests red before any implementation).** Write the whole suite, importing files that don't exist yet, so it's entirely **red**: (4) test factory in `src/__tests__/factories/` → (5) repository integration tests → (6) mapper tests → (7) service tests (happy path, authz with wrong `userId`, domain limits, the Phase-3 codes) → (8) route e2e tests. No implementation file exists yet. The pre-commit hook runs `pnpm check && pnpm tsc --noEmit`, so keep the tree type-clean as you go.
- **Block 3 — Code (implement layer by layer until green).** Write only what's needed to pass: (9) repository (pure Prisma, no business rules) → (10) mapper (`Prisma.<X> → <X>DTO`) → (11) service (business rules, `Result`) → (12) HTTP routes + `[id]` route → (13) hook + frontend wiring → (14) observability + manual smoke.
- **Authorization lives in the service**, not the route (ownership checks like session `userId == resource userId`; module access for CRM/WhatsApp features).
- **Frontend wiring is part of "done":** creating `src/hooks/use-<feature>.ts` without integrating the existing component does not close the feature.
- **Observability before the final smoke:** Axiom logs at critical service points, plus `auditMutation`/`auditAuth` for LGPD-sensitive events. Type-check and tests verify code correctness, not feature behavior — always smoke the golden path + a few edge cases in the browser (local app on :3001).
- Phases 9–11 collapse into near-one block for trivial domains; cache (`src/cache/`) is optional, slotted between the mapper and service when reads become a bottleneck.

## Git workflow

The project follows **trunk-based development with direct commits to `main`** (ADR 0001):

- **`main` is the trunk and the only working branch** — commit directly to it. There is no `dev` branch and no per-feature/per-version PR in the standard flow.
- **The CI gate is the safety net, not a PR review window.** `ci.yml` runs on `push: [main]` (lint, typecheck, unit, integration, e2e, coverage, build, and the security jobs — audit, snyk, semgrep, gitleaks). `cd.yml` deploys only via `workflow_run` of a **successful** CI run on `main` (self-hosted runner on the production server — ADR 0005), so a red CI never reaches production. Locally, the pre-commit hook (`pnpm check && pnpm tsc --noEmit`) and `commit-msg` (commitlint) fail fast before code leaves the machine.
- **Releases are CalVer** (`YYYY.MM.DD[.N]`, UTC) tagged by the CD after a successful deploy (ADR 0003). The tag is the source of truth; `package.json`/`openapi.json` carry the last synced release (`pnpm version:sync`).
- **Commit granularity is the unit of integration** — small, thematic Conventional Commits. Never `git push --force` to `main` (release tags are immutable).
- **PRs are the exception, not the rule** — reserved for Dependabot, external contributors and **parallel slices** (two or more fronts building at once, e.g. agents in worktrees): there each slice goes through a short-lived branch and a PR, merged only with CI green (ADR 0010). Sequential work still commits straight to `main`.

## Conventions

- **Path alias `@/`** maps to repo root (e.g. `@/src/services/...`, `@/lib/...`, `@/components/...`). Note there are two `lib` dirs: root `lib/` (axiom, env, abacatepay, legal, version) and `src/lib/` (auth, prisma, redis, queue, rate-limit, result, storage, mail, whatsapp, social, module-db, crypto).
- **Env vars** are validated with Zod and split into `lib/env/env.ts` (public) and `lib/env/server.ts` (server; `_server.ts` holds the schema). Always import the typed export — never read `process.env` directly (only exceptions: the env modules themselves and vendored UI in `components/ui`). New vars go into the schema **and** `.env.example`. Boolean flags are kept as `'true'`/`'false'` strings (compare `=== 'true'`) so `SKIP_ENV_VALIDATION=true` / `NODE_ENV=test`, which bypass validation, behave the same.
- **Biome** is the linter/formatter (config in `biome.json`). Note the deliberate split: 2-space indent + single quotes + no semicolons for JS/TS via the `javascript.formatter` block, but the top-level `formatter.indentStyle` is `tab`. Run `pnpm check` before committing; `noParameterAssign` and several `style` rules are errors.
- **Commits** follow Conventional Commits, enforced by commitlint + Husky pre-commit hooks.
- **Language split (strict):** everything that is engineering — commit messages (subject **and** body), PR titles and bodies, branch names, code comments, docstrings, identifiers, log messages, technical error messages, and anything written into a GitHub issue or PR — is **English**. Everything the end user reads — UI strings, user-facing error messages, transactional e-mail copy — is **Portuguese (pt-BR)**. **One exception, decided by the product owner: `docs/` stays in pt-BR** — runbooks, ADRs and architecture notes are read by the dev and IT team, and Portuguese is easier for them. Commits before 2026-10-02 have pt-BR bodies; history is not rewritten.
- Prisma models use `@map`/`@@map` to snake_case DB names while keeping camelCase in code.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
