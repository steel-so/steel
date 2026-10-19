# Architecture Decision Records (ADR)

Registro curto das decisões de arquitetura e operação do Steel que já estão
valendo. Cada ADR responde três perguntas: **qual era o contexto**, **o que foi
decidido** e **quais as consequências** (inclusive as ruins).

## Como usar

- Um arquivo por decisão: `NNNN-slug-curto.md`, numeração sequencial, nunca
  reaproveitada.
- Copie [`template.md`](./template.md) e preencha. Meia página é o tamanho
  certo; se passar de uma página, provavelmente são duas decisões.
- ADR é **append-only**: não reescreva uma decisão antiga. Se ela mudar, crie
  um ADR novo com `Status: Aceita` e marque o antigo como
  `Substituída por NNNN`.
- Status possíveis: `Proposta`, `Aceita`, `Substituída por NNNN`, `Descontinuada`.

## Índice

| #    | Decisão                                                                 | Status | Data       |
| ---- | ----------------------------------------------------------------------- | ------ | ---------- |
| 0001 | [Trunk-based em `main` com CI como gate](./0001-trunk-based-main-ci-gate.md) | Aceita | anterior a 2026-09 |
| 0002 | [`Result` em vez de exceções entre camadas](./0002-result-type-instead-of-exceptions.md) | Aceita | anterior a 2026-09 |
| 0003 | [Versionamento CalVer](./0003-calver-versioning.md)                      | Aceita | 2026-09-18 |
| 0004 | [Coleta do status page via jobs repetíveis do worker](./0004-status-collection-worker-jobs.md) | Aceita | 2026-09-18 |
| 0005 | [Runner self-hosted no servidor de produção (por ora)](./0005-self-hosted-runner-on-prod-server.md) | Aceita | 2026-09-13 |
| 0006 | [Assistente de IA central via Claude Code em container; sem dados pessoais de clientes nos prompts](./0006-central-ai-assistant-claude-code.md) | Aceita | 2026-09-13 |
| 0007 | [IA multi-provedor (OpenAI + Anthropic) habilitada por workspace](./0007-multi-provider-ai-per-workspace.md) | Aceita (implementada); regra de custo substituída em parte por 0019 | 2026-09-18 |
| 0008 | [ServiceDesk ITIL 4 com motor configurável por workspace](./0008-servicedesk-itil-configurable-engine.md) | Aceita | 2026-09-21 |
| 0009 | [Construir a imagem num runner hospedado; deploy segue no servidor](./0009-build-image-on-hosted-runner.md) | Aceita | 2026-10-01 |
| 0010 | [PRs de vida curta quando as fatias são construídas em paralelo](./0010-short-lived-prs-for-parallel-slices.md) | Aceita | 2026-10-01 |
| 0011 | [CSP com nonce, sem `strict-dynamic`, por causa do Cache Components](./0011-csp-nonce-without-strict-dynamic.md) | Aceita | 2026-10-01 |
| 0012 | [Módulos opt-in por workspace e banco próprio por módulo](./0012-modules-opt-in-and-per-module-database.md) | Aceita | anterior a 2026-09 |
| 0013 | [RBAC por perfil (recurso × ação) com negação por padrão](./0013-rbac-profiles-deny-by-default.md) | Aceita | anterior a 2026-09 |
| 0014 | [Storage S3 na imagem Silo (fork do MinIO)](./0014-minio-replaced-by-silo-fork.md) | Aceita | 2026-10-01 |
| 0015 | [Suíte dividida em projetos e piso de cobertura de 95%](./0015-test-projects-and-coverage-floor.md) | Aceita | 2026-09-19 |
| 0016 | [Risco preditivo por heurística explicável, não por modelo treinado](./0016-predictive-risk-explainable-heuristic.md) | Aceita | 2026-10-02 |
| 0017 | [Sentry e PostHog, opcionais e inertes, sem origem nova na CSP](./0017-sentry-and-posthog-optional-and-inert.md) | Aceita | 2026-10-02 |
| 0018 | [Steel AI: modo agente com confirmação no servidor](./0018-steel-ai-agent-mode-server-confirmation.md) | Aceita | 2026-10-06 |
| 0019 | [Custo real de IA por modelo com margem da plataforma](./0019-real-ai-cost-per-model-with-platform-margin.md) | Aceita | 2026-10-06 |
| 0020 | [Steel Agents: identidade do responsável, ferramenta automática ou aprovada](./0020-steel-agents-owner-identity-and-approvals.md) | Aceita | 2026-10-06 |
| 0021 | [Steel AI: modo Autopilot executa escritas sem confirmação](./0021-steel-ai-autopilot-mode.md) | Aceita | 2026-10-07 |
| 0022 | [Steel AI: memória salva sem confirmação, com guarda e desfazer](./0022-steel-ai-memory-saved-without-confirmation.md) | Aceita | 2026-10-08 |
| 0023 | [Steel AI: modo Teste simula as escritas no servidor](./0023-steel-ai-test-mode-simulates-writes-server-side.md) | Aceita | 2026-10-08 |
| 0024 | [Integrações (Slack, GitHub, GitLab) no nível do workspace](./0024-workspace-level-integrations.md) | Aceita | 2026-10-08 |
| 0025 | [Campanha multicanal: e-mail + WhatsApp opcional, sem grafo de etapas](./0025-crm-multichannel-campaign-execution.md) | Aceita | 2026-10-09 |
| 0026 | [Steel Canvas: um motor de arrastar e soltar para e-mail e sites](./0026-steel-canvas-shared-drag-and-drop-engine.md) | Aceita | 2026-10-14 |
| 0027 | [Coedição em tempo real do Steel Canvas sobre o servidor realtime da Wiki](./0027-canvas-real-time-co-editing.md) | Aceita | 2026-10-15 |
| 0029 | [Campanhas apontam para páginas de site; a atribuição acontece no site](./0029-crm-campaigns-target-site-pages.md) | Aceita | 2026-10-15 |
| 0031 | [Kit de Vendas calculado no servidor e modo TV por link com token](./0031-crm-sales-tv-kit.md) | Aceita | 2026-10-15 |
| 0032 | [Servidor MCP público sobre as ferramentas do Steel AI](./0032-public-mcp-server-over-steel-ai-tools.md) | Aceita | 2026-10-17 |
| 0033 | [Identidade de integrações: OAuth por usuário e workspace](./0033-integration-identity-oauth-per-user-and-workspace.md) | Aceita | 2026-10-17 |
| 0034 | [Steel CLI e SDK em repositório próprio](./0034-steel-cli-and-sdk.md) | Aceita | 2026-10-18 |
| 0035 | [API pública v1 e tokens pessoais](./0035-public-api-v1-and-personal-tokens.md) | Aceita | 2026-10-18 |
| 0036 | [Webhooks de saída](./0036-outbound-webhooks.md) | Aceita | 2026-10-18 |
| 0038 | [Réplicas do app atrás de um upstream do nginx](./0038-app-replicas-behind-nginx-upstream.md) | Aceita | 2026-10-18 |
