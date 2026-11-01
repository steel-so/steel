<br />
<br />

<p  align="center">
    <a href="https://steel.stratustelecom.com.br" target="_blank" align="center">
      <img
        src="./public/brand/logo.svg"
        alt="Steel"
        width="50%"
        align="center"
      />
    </a>
</p>
<p align="center"><b>ServiceDesk, CRM, Comunicação and Steel AI — one platform per workspace</b></p>

<p align="center">
    <a href="https://steel.stratustelecom.com.br/"><b>Website</b></a> •
    <a href="https://steel.stratustelecom.com.br/status"><b>Status</b></a> •
    <a href="https://steel.stratustelecom.com.br/changelog"><b>Changelog</b></a> •
    <a href="https://x.com/steelpowers"><b>X</b></a>
</p>

<p align="center">
  <a href="https://www.react.doctor/share?p=steel&s=84&e=1&w=62&f=31">
    <img src="https://www.react.doctor/share/badge?p=steel&s=84&e=1&w=62&f=31" alt="React Doctor" />
  </a>

  <a href="https://codecov.io/gh/StratusTI/steel">
    <img src="https://codecov.io/gh/StratusTI/steel/graph/badge.svg?token=3c586d5c-e149-4988-b7ec-480ee0a75864" alt="Codecov" /> <!-- gitleaks:allow — Codecov's badge graph token is meant to be public in READMEs, it's not an API credential -->
  </a>

  <a href="https://github.com/steel-so/steel/actions/workflows/ci.yml">
    <img src="https://github.com/steel-so/steel/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>

  <a href="https://github.com/steel-so/steel/actions/workflows/cd.yml">
    <img src="https://github.com/steel-so/steel/actions/workflows/cd.yml/badge.svg" alt="CD" />
  </a>
</p>

[Steel](https://steel.stratustelecom.com.br/) is Stratus Telecom's multi-tenant platform. One workspace brings together an ITIL 4 **ServiceDesk**, a **CRM**, **Comunicação** (WhatsApp Business) and **Steel AI**, an assistant that knows all three. Each module is enabled per workspace, and a workspace can point any module at its own external Postgres instead of Steel's.

## Modules

- **ServiceDesk (ITIL 4).** Incidents, service requests, changes and problems on a configurable engine (phases, transitions, SLA pause), impact × urgency priority matrix, catalog, SLA/OLA over business calendars, escalation and automation rules, CMDB, customers and contacts, knowledge base with KCS, tasks, costs and parts, e-mail approvals, digital signature, WhatsApp inside the ticket, AI copilot and triage, predictive risk, scheduled SLA reports, Slack/GitHub integrations, dashboards with TV mode and a requester portal.
- **CRM.** Leads with scoring and routing, people, companies, opportunities and pipelines, proposals and templates, products, forecast and quotas, tasks and activities, custom fields, reports and dashboards, e-mail campaigns and sync, landing pages and forms, workflows, competitors and social accounts (Facebook, Instagram, TikTok, YouTube, Google Ads/Analytics).
- **Comunicação.** WhatsApp Business through Meta Cloud API or Z-API: conversations in realtime, contacts and groups, templates, quick replies, broadcasts with CSV import, dashboards, knowledge documents, AI auto-reply and sentiment.
- **Steel AI.** A full-page chat at `/ai` that reads across every module, with OpenAI and Anthropic models.
  - **Modes:** *Ask* answers only. *Build* proposes writes that run after a server-side confirmation, and deletes need a second one. *Autopilot* executes alone and logs everything; an admin switches it on. *Teste* runs reads for real and only simulates writes.
  - **Context:** file and image attachments, reusable `/skills`, and a reviewable workspace and personal memory.
  - **Steel Agents:** autonomous agents on a schedule. Each tool runs automatically or waits for approval in the inbox, and a ready-made template gallery helps admins get started.
  - **Cost:** usage and analytics tabs with CSV export, the quota counted at the real per-model price, and a weekly consumption e-mail to the owner.
- **Workspace.** Home with the Steel AI handoff, inbox across all modules (snooze, mark all read, AI approvals), global search on `Ctrl+K` with relevance ranking, wiki with realtime collaboration, sticky notes, roles (`OWNER`, `ADMIN`, `MEMBER`, `VIEWER`) and RBAC profiles.
- **Platform.**
  - **Auth:** e-mail and password, Google and GitHub OAuth, and a second factor by e-mail OTP or authenticator app.
  - **Public site:** a `/status` page with proactive probes and incident history, and a public `/changelog` in MDX.
  - **Operations:** an admin panel with traffic analytics, daily encrypted backups with an off-site copy, and LGPD data export and account deletion.

Billing (AbacatePay) is in the code but **off by default** (`BILLING_ENABLED`).

## Stack

- **Backend:** Next.js 16 (App Router), PostgreSQL 17 with Prisma 7, Redis 8 (TLS), BullMQ worker, a Yjs/Hocuspocus realtime server, MinIO-compatible storage (Silo), Better Auth and Resend.
- **Frontend:** React 19, Tailwind CSS 4, shadcn/Base UI, TanStack Query, Plate editor, React Email and Hugeicons.
- **Quality:** Vitest split into unit, integration, component and e2e projects with a 95% coverage floor, Biome, Commitlint, Husky, Lighthouse CI and k6.
- **Observability:** Axiom for structured logs and the LGPD audit trail, Sentry for errors and PostHog for product analytics. All three are optional and stay inert without keys.

## Local development

You need Node 22, pnpm and Docker.

```bash
pnpm install
cp .env.example .env      # fill in the values; Axiom/Sentry/PostHog can stay empty locally
pnpm docker:create        # first run only: Postgres (5433), Redis TLS (6380), MinIO
pnpm dev                  # starts the infra, applies migrations, runs Next on :3001
pnpm worker:dev           # background jobs (separate terminal)
pnpm realtime:dev         # wiki collaboration server (separate terminal)
```

Other useful commands:

| Command | What it does |
| --- | --- |
| `pnpm test:unit` / `test:integration` / `test:component` / `test:e2e` | Run one Vitest project. Integration tests truncate the local database. |
| `pnpm test:coverage` | Unit and integration tests with the 95% floor. |
| `pnpm check` | Biome lint and format, with fixes. |
| `pnpm email` | React Email preview on :3002. |
| `pnpm openapi:generate` | Regenerates `public/openapi.json` from the Zod schemas. |

Port 3000 is reserved for the production container. Locally the app always runs on **3001**.

## How we ship

- **Trunk-based development on `main`.** Work commits straight to `main`, and parallel slices go through short-lived PRs (ADR 0001, ADR 0010).
- **CI on every push.** It runs lint, typecheck, the test projects with coverage, a Next build, a Docker image build, and security scans with audit, Snyk, Semgrep and gitleaks.
- **CD after green CI.** Each green CI on `main` builds the image, scans it with Trivy, migrates, deploys to homologação and tags a CalVer release (`YYYY.MM.DD[.N]`).

## Documentation

All engineering docs live in [`docs/`](./docs), in Portuguese:

- [Architecture overview](./docs/architecture/overview.md): layers, modules, worker queues, infrastructure and delivery.
- [ADRs](./docs/adr/README.md): every architecture decision.
- [Runbooks](./docs/runbooks/README.md): health check, restart, restore, red CI and failed deploys.
- [ServiceDesk](./docs/servicedesk/README.md) and [Steel AI](./docs/steel-ai/README.md) contracts.
- [LGPD](./docs/lgpd.md), [API](./docs/api.md), [plans](./docs/plans-review.md) and the [admin panel](./docs/admin-panel.md).

The API reference is generated from the Zod schemas and rendered with Scalar.

## Security

If you find a security vulnerability, report it privately instead of opening a public issue. E-mail **security@stratustelecom.com.br** with a description and reproduction steps.

## License

Proprietary. All rights reserved.
