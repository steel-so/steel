# Arquitetura do Steel — visão macro

O **Steel** é a plataforma multi-tenant da Stratus Telecom que junta, num
mesmo workspace, **ServiceDesk**, **CRM** e **Comunicação (WhatsApp
Business)**. Nasceu da base **Nexo** (gestão de projetos): auth, workspaces,
billing, status page, e-mails e a arquitetura em camadas vêm de lá; os
módulos CRM e Comunicação foram construídos em cima.

Stack: Next.js 16 (App Router) · PostgreSQL 17 / Prisma 7 · Redis 8 (TLS) ·
BullMQ · MinIO (S3) · Better Auth · Axiom (logs) · pnpm.

## Visão geral

```
                    Internet
                       │  HTTPS
                  ┌────▼─────┐
                  │  nginx   │  TLS, proxy; /media/ → MinIO (buckets públicos)
                  └────┬─────┘
                       │ :3000
   ┌───────────────────▼──────────────────┐      ┌──────────────────────────┐
   │ nextjs-app (imagem ghcr steel)        │      │ steel-worker (mesma imagem│
   │  proxy.ts → app/ (UI + app/api/**)    │      │  `node dist/worker.cjs`)  │
   │  rota → service → repository → Prisma │      │  BullMQ Workers + crons   │
   └──┬──────────────┬──────────────┬──────┘      └──┬──────────┬───────────┬─┘
      │              │              │                │          │           │
 ┌────▼────┐   ┌─────▼─────┐   ┌────▼─────┐          │          │           │
 │steel-db │   │steel-redis│   │steel-minio│◄─────────┴──────────┴───────────┘
 │PG 17    │   │TLS, filas,│   │S3: mídia, │
 │:5433    │   │cache, rate│   │backups,   │──── cópia offsite (S3 externo)
 └─────────┘   │limit, pub/│   │exports    │     do backup FULL diário
               │sub        │   └───────────┘
               └───────────┘
 Externos: Resend (e-mail) · AbacatePay (pagamento, desligado*) · Meta Cloud
 API / Z-API (WhatsApp) · OpenAI/Anthropic (IA) · Google/GitHub OAuth · redes
 sociais (Meta, TikTok, X, LinkedIn, YouTube, Google Ads) · Axiom (logs)
```

\* A cobrança está desligada por decisão de produto (06/10/2026): a flag
`BILLING_ENABLED` (default `false`) esconde checkout, cupons, webhook, CTAs
de upgrade e a sonda de pagamento do status, sem remover o código. Detalhes
e como religar em `docs/plans-review.md`.

## Camadas (fluxo de uma requisição)

```
app/api/**/route.ts  →  Service        →  Repository   →  Prisma
  withAxiom              regras, authz,    só acesso a      PostgreSQL
  sessão, rate limit,    auditoria         dados
  Zod safeParse          → Result          → Result
```

- **Rota** (`app/api/**/route.ts`): fina. `withAxiom` → `getAuthSession()` →
  `consume(apiLimiter, ...)` → validação Zod → service → `successResponse` /
  `handleError`.
- **Log de requisição**: `withAxiom` e o `proxy.ts` gravam no Axiom um evento
  por requisição (`lib/axiom/request-log.ts`) com rota normalizada,
  usuário/workspace, código de erro e país/cidade (GeoLite2) — **sem IP nem
  User-Agent cru**. É a fonte do [Analytics do admin](../admin-analytics.md).
- **Limite de campos do Axiom**: o dataset tem teto de 257 colunas e cada
  chave nova em `fields` (inclusive cada folha de um objeto aninhado) vira
  uma coluna; passado o teto, o Axiom **descarta** os campos novos. Por isso:
  o `logger` do servidor (`lib/axiom/logger.ts`) transforma qualquer objeto
  ou array aninhado em `fields` numa única string JSON (formatter
  `flattenNestedFields`, `lib/axiom/log-fields.ts`), e os logs do Steel AI,
  do consumo de IA, dos Steel Agents e das notificações usam `logFields()`:
  só as chaves fixas `component`, `workspaceId`, `conversationId`,
  `actionId`, `message` e **uma** string `detail` com o resto (ferramentas,
  tokens, modelo...). Log novo nessas áreas não cria chave nova — põe no
  `detail`. O `request` do log de requisição fica na raiz do evento e não é
  afetado.
- **Lista fixa de campos**: depois do `flattenNestedFields`, o formatter
  `capFieldKeys` (`lib/axiom/log-fields.ts`) só deixa no topo de `fields` as
  chaves de `ALLOWED_LOG_FIELD_KEYS` (escopo, auditoria, erro, worker, IA);
  o resto vai para dentro do `detail`. O dataset fica com um número fixo de
  colunas, seja qual for o log novo. Chave nova que precise virar coluna
  (para filtrar no Axiom) entra nessa lista de propósito.
- **Ruído do worker fora do Axiom**: o `NoiseFilterTransport`
  (`lib/axiom/transports.ts`) descarta, só no envio ao Axiom, o
  `*.tick_completed` de um tick que não fez nada e o
  `queue.status_collect.completed` (o resultado já fica em `HealthCheck`); o
  worker não loga `queue.job.completed` de job repetível. Aviso e erro nunca
  são descartados, e o console continua mostrando tudo.
- **Axiom é opcional**: sem `NEXT_PUBLIC_AXIOM_TOKEN`/`NEXT_PUBLIC_AXIOM_DATASET`
  os loggers do servidor e do navegador escrevem só no console
  (`lib/axiom/transports.ts`) e a exportação LGPD pula a trilha de auditoria.
  A máquina local e os worktrees de agentes **não** têm essas chaves: antes,
  builds locais, e2e e testes gravavam no mesmo dataset da homologação e
  lotaram as colunas. Só o deploy (build-args do `cd.yml` + `.env` do SOPS)
  envia logs.
- **Service** (`src/services/*.service.ts`): regras de negócio,
  **autorização** (ownership, papel no workspace, acesso ao módulo) e
  auditoria (`auditMutation`/`auditAuth`, `lib/axiom/audit`).
- **Repository** (`src/repositories/*.repository.ts`): Prisma puro, sem regra.
- **Mapper** (`src/mappers`): model Prisma → DTO da API.
- **Schema** (`src/schemas`): Zod de entrada/saída (contrato primeiro).
- **Cache** (`src/cache`): read-through no Redis (workspace, user, status...).
- Nada lança exceção entre camadas: tudo devolve `Result<T, AppError>`
  ([ADR 0002](../adr/0002-result-type-instead-of-exceptions.md)).

`proxy.ts` (não `middleware.ts`) é a entrada de toda requisição: nonce de CSP,
headers de segurança, log e gate de autenticação (rotas públicas passam; o
resto exige o cookie `better-auth.session_token`).

## Multi-tenancy e acesso a módulos

- Tudo é escopado por **workspace**; URLs privadas são
  `app/(private)/[workspace-slug]/...`. Papéis: `OWNER`, `ADMIN`, `MEMBER`,
  `VIEWER` (`src/lib/permissions.ts`, `src/services/authz.ts`).
- **Módulos** (`enum ModuleKind`: `SERVICE_DESK`, `CRM`, `COMMUNICATION`) são
  habilitados por workspace (`WorkspaceModuleAccessService`). Os layouts de
  cada módulo chamam `hasModuleAccess()` (`src/lib/module-access-guard.ts`) e
  respondem `notFound()` se o workspace não tiver o módulo.
- Um workspace pode apontar um módulo para um **Postgres externo próprio**
  (`WorkspaceModuleConnection`, credenciais cifradas com `CONNECTION_SECRETS`,
  resolvido por `src/lib/module-db/resolver.ts`).
- Planos (`FREE`, `PRO`, `BUSINESS`, `ENTERPRISE`) em `src/config/plans.ts` —
  ver [revisão de limites](../plans-review.md).
- **Feature flags** por workspace (capacidades opcionais dentro de um módulo,
  default por plano + override do admin): [feature-flags](../feature-flags.md).

- **Ciclo de vida** (`workspaces.status`): `ACTIVE`, `SUSPENDED` (bloqueio
  pelo admin global — `assertMember` responde `WORKSPACE_SUSPENDED`) e
  `DELETING` (exclusão em andamento). Ver [painel admin](../admin-panel.md).

## Módulos de domínio

| Módulo | UI | API / serviços |
| ------ | -- | -------------- |
| **CRM** | `[workspace-slug]/crm/*` — leads, pessoas, empresas, oportunidades, pipelines, propostas, produtos, forecast, cotas, relatórios, dashboards, campanhas de e-mail, listas, landing pages, formulários, workflows, redes sociais, IA | `src/services/crm-*.service.ts`, `app/api/crm/*` (forms, landing pages, propostas, integrações, workflows) |
| **Comunicação (WhatsApp)** | `[workspace-slug]/zap/*` — conversas, contatos, grupos, templates, respostas rápidas, transmissões, dashboards, relatórios, configurações | `src/services/whatsapp-*.service.ts`, `src/lib/whatsapp/*` (Meta Cloud API e Z-API), webhooks em `app/api/whatsapp/webhook/{meta,zapi}`, tempo real via SSE `app/api/whatsapp/events` (Redis pub/sub) |
| **ServiceDesk (ITIL 4)** | `[workspace-slug]/servicedesk/*` — início, quadros de chamados (incidente, requisição, mudança, problema) em kanban/lista/tabela, tela do chamado com abas (histórico/chat, WhatsApp, tarefas, custos, aprovação, peças, itens filhos, escalonamento, rastreabilidade, assinatura, conhecimento), cadastros (clientes, empresas, contatos, CMDB), base de conhecimento, painéis (+ modo TV), portal do solicitante e configurações | `src/services/sd-*.service.ts` + `SdTicketEngine`, `src/lib/servicedesk/*` (SLA em minutos úteis, condições, realtime), `app/api/workspaces/[id]/servicedesk/**`, aprovação pública em `app/api/servicedesk/approvals/[token]`, filas `servicedesk-sla`, `servicedesk-ai`, `servicedesk-mail`, `servicedesk-digest`, `servicedesk-recurring` e `servicedesk-billing` — ver [ServiceDesk](../servicedesk/README.md) e [ADR 0008](../adr/0008-servicedesk-itil-configurable-engine.md) |
| **Base (Nexo)** | auth, onboarding, settings (membros, billing, conexões), wiki, IA, sticky notes, short links, `/status`, referência da API (Scalar em `/reference`, gerada de `src/openapi/` — ver [API](../api.md)) | `src/services/{workspace,membership,invitation,subscription,user,...}.service.ts` |

Campanhas de e-mail e transmissões do WhatsApp respeitam o descadastro LGPD
(link + `List-Unsubscribe` no e-mail, palavras-chave no WhatsApp) — regras,
registro e política de reinscrição em [LGPD — descadastro](../lgpd.md).

Os templates de e-mail do CRM têm um **editor visual** (galeria de modelos
prontos sobre componentes do React Email, estrutura travada, edição só do
conteúdo, marca do workspace, variáveis por contato) e a API de renderização
`renderCampaignEmail` para as campanhas — ver
[CRM · Editor visual de e-mail](../crm-email-builder.md).

**Atendimento no WhatsApp** (Configurações do WhatsApp > Atendimento, só
OWNER/ADMIN; `WhatsAppSettings`):

- **Fechar conversa.** Atendentes fecham (motivo opcional) e reabrem pelo
  cabeçalho da conversa; fechadas saem da caixa ativa (aba "Fechadas") e a IA
  não responde. Nova mensagem do contato reabre a mesma conversa. O job
  `whatsapp-conversation-lifecycle` fecha conversas sem mensagem há N horas
  (padrão 24h, 0 = desligado). Fechar/reabrir vira evento na linha do tempo
  (`whatsapp_conversation_events`) e é auditado.
- **Alerta de sentimento.** Quando a média de sentimento da conversa cai até o
  limite (padrão -0,3), avisa os membros escolhidos (padrão OWNER/ADMIN) na
  caixa de entrada do app (`notifications`, `/[slug]/inbox`) e/ou por
  e-mail, e pode atribuir a conversa sem atendente a um supervisor. No máximo
  um alerta por conversa a cada N horas (padrão 6).
- **Mídia em transmissões.** Imagem (JPG/PNG, 5 MB), vídeo (MP4/3GP), áudio
  (AAC/M4A/MP3/AMR/OGG) ou documento (PDF/Office/TXT) até 16 MB, enviados
  com o tipo certo na Meta e na Z-API (`src/lib/whatsapp/broadcast-media.ts`).
  Áudio não tem legenda: a mensagem segue como texto logo depois.

## Integrações do workspace (Slack, GitHub, GitLab)

Desde a [ADR 0024](../adr/0024-workspace-level-integrations.md) as conexões
com Slack, GitHub e GitLab são **do workspace** (tabela
`workspace_integrations`), configuradas uma vez em **Ajustes > Integrações**
por OWNER/ADMIN e usadas por todos os módulos:

- **Conexão**: `WorkspaceIntegrationService` (conectar, testar, trocar
  token/segredo, desconectar; tudo auditado). Token e segredo cifrados com
  `CONNECTION_SECRETS`, nunca devolvidos. Sem as credenciais do app do Slack
  no servidor, o card aparece indisponível com o motivo. GitLab aceita
  gitlab.com ou instância própria (só HTTPS, host público).
- **Notificações no Slack**: regras "evento → canal" por módulo (catálogo em
  `src/lib/integrations/catalog.ts`). Os módulos chamam
  `notifyWorkspaceSlack` (`src/services/workspace-slack-notifier.ts`), que
  só enfileira (`workspace-integrations`); o ServiceDesk segue no job
  `deliver-event` da fila dele, com o canal por time substituindo o da regra.
  Eventos de hoje: chamado novo/urgente, SLA violado e demais eventos de
  chamado; CRM novo lead e negócio ganho/perdido; Comunicação conversa
  aguardando; Steel Agents aprovação pendente.
- **Repositórios**: GitHub e GitLab com o mesmo conjunto de recursos nos
  chamados (vínculo de issue/PR/MR, abrir issue, estado por webhook,
  reconciliação horária). Webhooks públicos em
  `/api/integrations/{github,gitlab}/webhook`, verificados por HMAC/token em
  tempo constante antes de qualquer gravação; o caminho antigo do GitHub
  continua aceito.

## Quadro-branco (Excalidraw)

Item **Quadro-branco** logo abaixo da Wiki no menu lateral (atalho
<kbd>G</kbd> <kbd>Q</kbd>), em `/[slug]/whiteboard`. Diferente da Wiki, vem
**ligado** (`workspaces.whiteboard_enabled`, padrão `true`): não guarda dado
nenhum até alguém criar um quadro, então o interruptor em **Ajustes >
Quadro-branco** (OWNER/ADMIN) serve para quem não quer o item no menu.
Desligado, as páginas respondem 404 e a API `403 WHITEBOARD_DISABLED`.

- **Camadas**: `src/schemas/whiteboard.schema.ts` →
  `WhiteboardService` / `WhiteboardVersionService` /
  `WhiteboardFileService` / `WhiteboardSettingsService` → repositórios
  `whiteboard*.repository.ts`. Gate único em `_whiteboard-access.ts`: membro
  do workspace + interruptor; VIEWER só lê; MEMBER arquiva os quadros que
  criou, OWNER/ADMIN qualquer um. Rotas em
  `app/api/workspaces/[id]/whiteboards/**` e `.../whiteboard/settings`.
- **Cena** (`whiteboards.scene`, JSONB até 5 MB / 20 mil elementos):
  elementos vivos, um recorte do appState (fundo, grade e viewport — cada
  quadro reabre no mesmo ponto) e só as **referências** das imagens. Os bytes
  vão para o bucket privado `whiteboards` (`<ws>/files/<fileId>`, o id do
  Excalidraw é hash do conteúdo, então cópias e versões reaproveitam o
  arquivo) e as miniaturas da lista para `<ws>/thumbnails/<id>.png`. Ambos
  servidos pela própria API (`Content-Security-Policy: sandbox`, `nosniff`).
- **Edição**: autosave com debounce de 1,5 s (`PUT .../scene`) com bloqueio
  otimista (`baseRevision` → `409 WHITEBOARD_REVISION_CONFLICT`) e **trava de
  edição** de 60 s renovada a cada 20 s pelo canvas aberto
  (`POST/DELETE .../lock`). Um editor por vez: os demais abrem em modo
  leitura, recebem a cena nova a cada 20 s e assumem a edição quando a trava
  vence (`409 WHITEBOARD_LOCKED` se tentarem gravar antes).
- **Por que não tempo real (Hocuspocus)**: o `steel-realtime` hoje é da Wiki
  (o nome do documento é o id da página, load/store presos ao
  `WikiPageRepository`) e não há binding Yjs ↔ Excalidraw nas dependências.
  Colaboração real exigiria um CRDT por elemento (reconciliação por
  `version`/`versionNonce` + índices fracionários), mapear awareness para os
  `collaborators` do Excalidraw e manter duas persistências (estado Yjs e a
  cena JSON que versões, miniaturas e busca leem). Ficou para uma fatia
  própria; a trava cobre o caso comum sem risco de sobrescrita.
- **Histórico** (`whiteboard_versions`): versão **AUTO** no primeiro
  salvamento e depois a cada 10 min de edição ou 100 salvamentos; **MANUAL**
  em "Salvar versão" (nome opcional); **RESTORE** ao restaurar. Retenção: as
  **50 AUTO mais recentes** por quadro (podadas na mesma transação);
  MANUAL e RESTORE ficam enquanto o quadro existir. Restaurar nunca apaga:
  se há edições sem versão, guarda antes um AUTO "Antes da restauração", põe
  a cena antiga numa nova revisão e registra o RESTORE.
- **Busca global**: tipo `whiteboard` em `search_documents` (título + texto
  dos elementos de texto), escondido quando o interruptor está desligado;
  reindexado ao criar/renomear/arquivar e a cada versão automática.
- **Biblioteca** do Excalidraw: pessoal, no `localStorage` do navegador.
  Exportar PNG/SVG/arquivo `.excalidraw` pelo menu do próprio canvas.
- **Arquivar** é soft (`archived_at`), com aba "Arquivados" e "Restaurar";
  backup/exclusão do workspace incluem os quadros e o histórico
  (`workspace-snapshot.ts`).

## Caixa de entrada (notificações in-app)

`/[slug]/inbox` é a caixa de entrada do usuário no workspace, no formato de
um **cliente de e-mail**: lista à esquerda, painel de leitura à direita
(coluna única no celular), pastas **Tudo / Não lidas / Adiadas /
Arquivadas**, filtros rápidos (**Pendências da IA**, Não lidas, Menções,
Atribuídas a mim), filtro por módulo e por tipo de evento, busca em título e
corpo, paginação por cursor, seleção múltipla com ações em lote (ler, não
ler, arquivar, adiar, excluir), desfazer e atalhos de teclado (`j`/`k`,
`Enter`, `u`, `e`, `r`, `s`, `i`, `#`, `x`, `/`), que fazem parte do registro
global de atalhos — ver [`docs/shortcuts.md`](../shortcuts.md).

- **Pendências da IA** (`?view=ai`): as ações do Steel AI que o próprio
  usuário pediu no modo Build e ainda esperam confirmação, mais as escritas
  de Steel Agents que ele pode aprovar (responsável pelo agente ou quem
  gerencia agentes — mesma regra da ADR 0020). Cada item mostra a prévia
  (antes → depois), a origem (conversa ou execução), a contagem regressiva
  e os botões Confirmar/Cancelar ou Aprovar/Rejeitar; exclusão pede
  confirmação dupla. A decisão usa as rotas já existentes
  (`/ai/actions/{id}/confirm|cancel`, `/agents/runs/{runId}/actions/{id}/approve|reject`),
  que revalidam tudo. O contador do cabeçalho soma não lidas e pendências.
  Cerca de 5 min antes de uma ação do assistente expirar, a fila
  `notifications` avisa o dono uma vez (`AI_ACTION_EXPIRING`, por
  `dedupeKey`).
- **Adiar**: 1 h, 3 h, amanhã às 9h ou próxima segunda às 9h, no fuso das
  preferências pessoais (`Notification.snoozedUntil`). A adiada some de todas
  as pastas (menos "Adiadas") e volta como não lida; "desfazer" é a ação
  `unsnooze`.
- **Ações rápidas por tipo** (painel de leitura): abrir o registro,
  **Responder** (histórico do chamado com o editor em foco —
  `?tab=history&reply=1` — ou a conversa), **Atribuir a mim** quando o
  chamado/conversa está sem responsável e "Silenciar avisos deste tipo"
  (preferências da plataforma ou do ServiceDesk). "Marcar todas como lidas"
  e "Arquivar todas as lidas" respeitam o módulo/tipo filtrado.
- **Notificações do navegador**: opt-in na caixa de entrada e em Ajustes >
  Notificações (`NotificationDeliverySetting.browserEnabled`, no servidor;
  `localStorage` é só cache). Saem do mesmo SSE, só com a aba em segundo
  plano e só para tipos urgentes (SLA violado/em risco, aprovação
  solicitada, aprovação de agente, chamado ou conversa atribuída, ação da IA
  expirando). Sem service worker nem Web Push por enquanto — com o app
  fechado não há aviso; fica como evolução.

- **Modelo**: `Notification` (workspace, usuário, `kind`, título, corpo,
  `href`, `readAt`, `archivedAt`, `deletedAt`). Arquivar e excluir são
  carimbos — a exclusão é lógica, o que permite restaurar ("desfazer").
- **Quem produz**: qualquer módulo, sempre por
  `NotificationService.notifyUsers` (ServiceDesk via
  `notifySdEvent`/`sd-notification`, o alerta de sentimento do WhatsApp, o
  CRM e a Plataforma). CRM e Plataforma entram por `emitNotification`
  (`src/services/notification-emitter.ts`), com o texto em
  `crm-notifications.ts`/`platform-notifications.ts`: é *fire-and-forget*
  (nunca derruba a operação de negócio), filtra quem não é mais membro e
  monta o link a partir do slug.
- **Regras de entrega** (em `notifyUsers`): quem causou o evento
  (`actorId`) nunca é avisado da própria ação; tipos fora do ServiceDesk
  respeitam a preferência por usuário (`NotificationPreference`, sem linha =
  ligado; o ServiceDesk tem a dele, `SdNotificationPreference`); e
  `dedupeKey` (único por usuário) torna idempotente o aviso disparado por
  job — rodar de novo não duplica.
- **Preferências**: `Ajustes do Workspace > Notificações`
  (`/[slug]/settings/notifications`), por tipo e agrupadas por módulo, via
  `GET|PUT /api/workspaces/[id]/notifications/preferences`.
- **Links para registros do CRM**: `?record=<id>` abre o painel do registro
  nas grades do CRM (`DataTable`) e no funil de leads.
- **Módulo, rótulo, ícone e cor** de cada `kind` vêm de uma tabela pura,
  `src/lib/notification-kind.ts` — o mapper já entrega `module`,
  `moduleLabel`, `kindLabel`, `icon` e `color` no DTO, e a interface nunca
  faz `switch` em `kind`. Tipo novo entra nessa tabela; tipo desconhecido
  tem o módulo inferido pelo prefixo (`SD_`, `WHATSAPP_`, `CRM_`).
- **Rotas**: `GET /api/workspaces/[id]/notifications` (filtros + cursor,
  `folder=snoozed`, `quick=mentions|assigned`),
  `POST .../notifications/read` (marcar todas, opcionalmente por
  `module`/`kind`), `POST .../notifications/archive-read`,
  `POST .../notifications/snooze`, `GET .../notifications/ai-pending`,
  `GET|PUT .../notifications/preferences/delivery` e
  `POST .../notifications/actions`
  (`read|unread|archive|unarchive|delete|restore|unsnooze`, até 100 ids). Autorização
  no service (`assertMember`): cada pessoa só enxerga e só mexe nas próprias
  notificações.
- **Tempo real**: canal **genérico** de notificação em Redis pub/sub
  (`notifications:workspace:<id>`, `src/lib/notifications/realtime.ts`),
  publicado por `notifyUsers` e consumido pelo SSE
  `GET .../notifications/events`, que filtra por destinatário (a lista de
  `userIds` nunca sai do servidor). A lista e o contador do cabeçalho se
  atualizam sem recarregar; o `refetchInterval` de 1 min é a rede de
  segurança. É separado do SSE de chamados do ServiceDesk
  (`servicedesk:workspace:<id>`), que avisa mudança de chamado, não
  notificação.

## Worker (BullMQ)

Processo Node separado (`worker/index.ts`, build `pnpm worker:build` →
`dist/worker.cjs`), mesma imagem Docker do app, container `steel-worker`.
Registra um `Worker` por fila e agenda os jobs repetíveis no boot
(`src/lib/queue/scheduler.ts`, fuso `America/Sao_Paulo`).

| Fila | Processor | Disparo |
| ---- | --------- | ------- |
| `data-retention` | limpa sessões/tokens expirados, expira convites | cron 03:00 |
| `account-lifecycle` | exclusão agendada de conta (30 dias) | sob demanda |
| `data-export` | export LGPD dos dados do usuário | sob demanda |
| `trial-lifecycle` | reverte trials vencidos | cron de hora em hora |
| `whatsapp-media` | baixa mídia recebida | por mensagem |
| `whatsapp-ai-reply` | resposta automática por IA | por mensagem |
| `whatsapp-sentiment` | análise de sentimento | por mensagem |
| `whatsapp-broadcast` | envio de transmissões + tick de agendadas | sob demanda + a cada 5 min |
| `whatsapp-conversation-lifecycle` | fecha conversas inativas (janela por workspace, padrão 24h) | a cada 15 min |
| `crm-scheduled-send` | campanhas de e-mail agendadas | a cada 5 min |
| `crm-campaigns` | campanhas multicanal ([ADR 0025](../adr/0025-crm-multichannel-campaign-execution.md)): `dispatch` (atrasado até o início do canal ou a abertura da janela de envio) enfileira lotes de `send` espaçados por canal/provedor; `send` reivindica o destinatário (`PENDING → SENDING`) e envia um e-mail ou WhatsApp; `tick` inicia agendadas, refaz o dispatch, libera linhas presas e fecha as concluídas | sob demanda + a cada 5 min |
| `crm-workflow-schedule` | workflows `on-a-schedule` | a cada 1 min |
| `crm-workflow-delay` | etapa **Atraso** dos workflows: o run fica `WAITING` com escopo e etapas pendentes em `run.state`; o job atrasado (`resume`) retoma do passo seguinte quando o prazo vence (se disparar antes, reagenda o restante) | sob demanda (job atrasado) |
| `crm-competitor-sync` | métricas e posts públicos de concorrentes (e da conta própria) para a análise comparativa | cron 04:00 |
| `crm-proposal-expiry` | expira propostas com validade vencida e avisa o responsável | cron 00:05 |
| `crm-task-reminders` | avisa na caixa de entrada o responsável por tarefas do CRM que vencem em até 1 h ou acabaram de atrasar (uma vez cada, por `dedupeKey`) | cron a cada 15 min |
| `crm-social-posts-tick` | publica posts sociais vencidos | a cada 1 min |
| `notifications` | `ai-action-expiry-tick`: avisa ~5 min antes de uma ação pendente do Steel AI expirar (uma vez por ação, `dedupeKey`) | a cada 1 min |
| `steel-agents` | Steel Agents: `tick` dispara agentes de agenda (cron + `lastRunAt`) e expira aprovações vencidas; `run` executa ou retoma uma execução, com as permissões do responsável ([ADR 0020](../adr/0020-steel-agents-owner-identity-and-approvals.md), [Steel AI](../steel-ai/README.md#steel-agents)) | a cada 1 min + sob demanda (tentativa única) |
| `search-reindex` | busca global (Ctrl+K): `reindex-all` reconstrói o índice `search_documents` de todos os workspaces e remove documentos de registros excluídos; `reindex-workspace` reconstrói um workspace. No dia a dia o índice é atualizado pelos services logo após cada escrita (`indexSearchDocument`, fire-and-forget); `pnpm search:reindex [workspace]` faz o backfill | cron 02:30 + sob demanda |
| `ai-usage-weekly-email` | resumo semanal do consumo do Steel AI por e-mail para os donos (OWNER) de cada workspace: o `tick` olha a semana UTC anterior (segunda a domingo, o relógio da cota) e enfileira um `send-workspace` por workspace elegível (Steel AI ligado, interruptor `usageWeeklyEmailEnabled` ligado, workspace ativo e algum gasto na semana ou na anterior), com `jobId` determinístico; uma marca no Redis por workspace, semana e dono impede reenvio em retry ([Steel AI](../steel-ai/README.md#resumo-semanal-de-consumo-por-e-mail)) | segundas às 08:00 + um job por workspace |
| `workspace-export` | Ajustes › Exportações: `run` monta uma exportação pedida por OWNER/ADMIN — **dados completos** (as linhas de `gatherWorkspaceData`, a mesma fonte do backup por workspace, mais nomes/e-mails dos membros; um JSON e um CSV por tabela, credenciais e tokens trocados por `[removido]`) ou **logs** (uma consulta APL ao Axiom filtrando `request.workspaceId`/`fields.workspaceId`, CSV + NDJSON, até 50 mil eventos; exige `AXIOM_QUERY_TOKEN`) — num ZIP no bucket `workspace-exports`, avisa o solicitante (caixa de entrada + e-mail) e o arquivo vale 7 dias, baixado pela rota autenticada; `prune-expired` apaga os vencidos e os órfãos. Cada tipo uma vez por dia por workspace (dia de São Paulo, índice único; falha libera o dia). Só o banco da plataforma: módulo apontado para Postgres externo não entra | cron 04:45 + sob demanda (2 tentativas) |
| `crm-social-publish` | publicação interativa de mídia grande | sob demanda |
| `changelog` | e-mails de changelog | sob demanda |
| `database-backup` | backup FULL (03:15), prune (03:30), backup por workspace, **cópia offsite**, exclusão e restauração de workspace pelo painel admin | cron + sob demanda |
| `status-collect` | probes do `/status` ([ADR 0004](../adr/0004-status-collection-worker-jobs.md)) | core 1 min, periféricos 5 min |
| `usage-rollup` | copia o uso por módulo do Redis para `module_usage_daily` ([métricas](../admin-metrics.md)) | a cada 15 min |
| `servicedesk-sla` | SLA dos chamados do ServiceDesk: marca risco/violação (uma vez), notifica, roda regras de escalonamento e automações de SLA, fecha RESOLVED após `autoCloseResolvedAfterHours` ([ServiceDesk](../servicedesk/README.md)) | a cada 1 min |
| `servicedesk-ai` | IA do ServiceDesk: triagem automática do chamado na abertura (categoria, prioridade, departamento, tags) quando `aiAutoTriageEnabled` | sob demanda |
| `servicedesk-mail` | Canal de e-mail do ServiceDesk: lê por IMAP as caixas ativas (`SdMailbox`), abre chamado ou anexa a resposta à thread, registra tudo em `SdMailMessage` ([ServiceDesk](../servicedesk/README.md)) | a cada 1 min (+ sob demanda por caixa) |
| `servicedesk-digest` | resumo diário opcional do ServiceDesk: o que ficou pendente com o agente (fila, SLA apertado, aguardando resposta). Só para quem marcou `digest.daily` nas preferências; sem retry (`attempts: 1`) para não reenviar ([ServiceDesk](../servicedesk/README.md)) | a cada hora (envia na hora local do workspace, `SD_DIGEST_HOUR`) |
| `servicedesk-recurring` | chamados recorrentes / manutenção preventiva: abre o chamado das rotinas com `nextRunAt` vencido (ator de sistema), registra a ocorrência e recalcula o próximo disparo no fuso da regra. Idempotente pelo par `(recurringId, scheduledFor)`; sem retry (`attempts: 1`) ([ServiceDesk](../servicedesk/README.md)) | a cada 5 min |
| `servicedesk-billing` | contratos de atendimento do ServiceDesk: abre o período do ciclo de cada contrato ativo e fecha o anterior já vencido, consolidando os apontamentos de hora (franquia, excedente, acumulado e valor). Idempotente por `(contractId, periodStart)` ([ServiceDesk](../servicedesk/README.md)) | diário às 00:20 |
| `workspace-integrations` | integrações do workspace ([ADR 0024](../adr/0024-workspace-level-integrations.md)): `slack-notify` entrega no Slack um evento de qualquer módulo que tenha regra (CRM, Steel Agents, Comunicação); `communication-waiting-tick` avisa conversas do WhatsApp aguardando resposta além do limite do workspace, uma vez por última mensagem | sob demanda (`slack-notify`) e a cada 5 min (tick) |

Dashboard das filas: `/jobs` (Workbench, basic auth `WORKBENCH_USER`/`WORKBENCH_PASS`).

### Alertas no Slack (#alerts)

O worker avisa o canal **#alerts** por um Incoming Webhook (`SLACK_ALERTS_WEBHOOK_URL`, que o deploy acrescenta ao `.env` a partir do secret do GitHub de mesmo nome). Sem a variável, os alertas viram só log (`alerts.slack.disabled`). O envio nunca derruba nada: POST simples com timeout de 3 s, e qualquer falha vira `alerts.slack.failed` no Axiom, sem a URL.

- **Componentes do `/status`** (`src/services/status/status-alerts.ts`): cada mudança de estado (caiu, piorou, melhorou, voltou). Se o componente oscila — 4 mudanças em 30 min —, sai um único "instável" e ele fica em silêncio até passar 15 min num mesmo estado, quando sai um "estabilizou". A regra relê `health_checks`, então sobrevive a restart. Se a coleta não consegue gravar no banco, sai um "a coleta de status falhou" e outro quando volta.
- **Job que morreu** (`src/lib/queue/failure-alarm.ts`): quando o BullMQ desiste de um job (tentativas esgotadas, erro irrecuperável ou stall), com dedup entre o `Worker` e o `QueueEvents`. Como quase todos os ticks rodam a cada minuto com `attempts: 1`, cada par fila/job avisa no máximo uma vez a cada 30 min; a mensagem seguinte diz quantas mortes iguais ficaram só no log (`queue.job.exhausted`).

Avisos de CI/CD vão para outro canal (secret `SLACK_WEBHOOK_URL`). Queda do servidor inteiro — quando o próprio worker cai — fica com o monitor externo do Better Stack.

## Infraestrutura

| Serviço | Container | Porta (host) | Observação |
| ------- | --------- | ------------ | ---------- |
| App Next | `nextjs-app` | 3000 | `docker-compose.yml`, atrás do nginx |
| Worker | `steel-worker` | — | mesma imagem, `node dist/worker.cjs` |
| Realtime (Wiki) | `steel-realtime` | 127.0.0.1:1235 | mesma imagem, `node dist/realtime.cjs` (Hocuspocus); nginx `/realtime` — ver `docs/runbooks/realtime-wiki.md` |
| PostgreSQL 17 | `steel-db` | 5433 → 5432 | `docker-compose.infra.yml`, volume `pgdata` |
| Redis 8 (TLS) | `steel-redis` | 6380 → 6379 | bitnami fixado por digest; certificados em `redis-tls/`; URL `rediss://` |
| MinIO | `steel-minio` | 127.0.0.1:9002 (API), 127.0.0.1:9003 (console) | imagem `docker.io/pgsty/silo` (fork AGPL mantido do MinIO, cuja distribuição pública saiu do ar); API nunca exposta publicamente |

Todos na rede Docker `steel_default`. Segredos de produção versionados
cifrados com SOPS em `secrets/production.enc.env`; o CD decripta para
`/var/www/steel/.env`. Variáveis de ambiente passam sempre pelos schemas Zod
em `lib/env/` (`env.ts` público, `server.ts` servidor).

**Local:** `pnpm dev` sobe a infra e o Next em **:3001**; preview de e-mails
(`pnpm email`) em **:3002**. A porta 3000 fica reservada ao container de
produção (e a outro projeto na máquina de desenvolvimento).

## Backups

- **FULL diário 03:15** (`pg_dump --format=custom`), cifrado pela aplicação
  (AES-256-GCM com `CONNECTION_SECRETS`) e gravado no bucket
  `database-backups` do MinIO; registro na tabela `backups`; retenção 90 dias
  (prune 03:30).
- **Cópia offsite**: após cada FULL, o job `copy-to-offsite` sobe o mesmo
  objeto cifrado para um storage S3-compatível externo (`BACKUP_OFFSITE_*`),
  com SSE e verificação por leitura; retenção própria
  (`BACKUP_OFFSITE_RETENTION_DAYS`, padrão 90). Inerte se não configurado.
- **Backup por workspace** sob demanda (painel `/admin/backups` ou
  `pnpm backup:workspace`) e automático antes de excluir/restaurar um
  workspace pelo painel. Leva as linhas (JSON) **e os arquivos do MinIO** do
  workspace — cada objeto copiado e cifrado individualmente para
  `database-backups` (memória limitada ao maior arquivo), com manifesto e
  SHA-256; `backups.file_count`/`file_bytes` registram o volume. O restore
  regrava só as chaves do manifesto (não apaga nada; idempotente; `--dry-run`
  no CLI). Quais buckets entram: `src/lib/storage/workspace-files.ts`. Mídias
  antigas de landing page/proposta (sem o workspace na chave) entram só
  quando citadas no conteúdo.
- **Arquivos do MinIO não têm cópia offsite:** o FULL é só `pg_dump` e o
  offsite copia só o FULL.
- Restore: [runbook](../runbooks/restore-backup.md).

## Entrega

Trunk-based em `main` ([ADR 0001](../adr/0001-trunk-based-main-ci-gate.md)):
push → `ci.yml` (lint, typecheck, unit, integration, e2e, build, segurança) →
se verde, `cd.yml` no runner self-hosted do servidor
([ADR 0005](../adr/0005-self-hosted-runner-on-prod-server.md)): migrations →
build + Trivy + push da imagem → `docker compose pull && up -d` em
`/var/www/steel` → tag CalVer + GitHub Release
([ADR 0003](../adr/0003-calver-versioning.md)) → aviso no Slack.
