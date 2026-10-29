# ServiceDesk — contrato do domínio

Decisão de arquitetura: [ADR 0008](../adr/0008-servicedesk-itil-configurable-engine.md).
Modelos: bloco `ServiceDesk` no fim de `prisma/schema.prisma` (tabelas `sd_*`).

## Convenções

- Prefixo `Sd` / `sd-` em tudo: `src/schemas/sd-<x>.schema.ts`,
  `src/services/sd-<x>.service.ts`, `src/repositories/sd-<x>.repository.ts`,
  `src/mappers/sd-<x>.mapper.ts`, `types/sd-<x>.d.ts`,
  `src/lib/servicedesk/*` (libs puras: SLA, condições, CPF/CNPJ, ViaCEP…),
  `src/hooks/use-sd-<x>.ts`, UI em `app/_components/servicedesk/**`.
- API autenticada: `app/api/workspaces/[id]/servicedesk/**` (mesmo padrão de
  `crm/*`: `withAxiom` → sessão → rate limit → `requireConsent` nas mutações →
  Zod → service → `successResponse`/`handleError`). Públicas (sem sessão, por
  token): `app/api/servicedesk/**` (ex.: aprovação por e-mail).
- UI: `app/(private)/[workspace-slug]/servicedesk/**`.
- Autorização **no service**: `assertModuleMember(actor, ws, 'SERVICE_DESK',
  { resource: 'sd-…', action })` + `SdAccess` (agente × solicitante) de
  `src/services/sd-access.ts`.
- Mutação relevante de chamado ⇒ `SdTicketEvent` (rastreabilidade) +
  `auditMutation` (entity `sd_ticket`, …). Dados pessoais (cliente, contato,
  assinatura) são LGPD-sensíveis: auditar, nunca logar o conteúdo.
- Erros: códigos `SD_*` em `src/errors/codes.ts` (factories `sd*` em
  `app-error.ts`). Não invente código inline.
- Strings de UI em pt-BR. Cobertura ≥ 95% nas 4 métricas para services,
  repositories, mappers, schemas e `src/lib/queue/processors`.

## Papéis

| Quem | Como é definido | O que faz |
| ---- | --------------- | --------- |
| Admin do módulo | OWNER/ADMIN do workspace (ou perfil com `sd-settings`) | configura tudo |
| Agente | membro com ≥ 1 `SdDepartmentMember` | fila, kanban, atende, vê todos os chamados (líder: supervisiona o time) |
| Solicitante | membro com acesso ao módulo e sem departamento | portal: abre chamado, conversa, acompanha, assina, avalia (CSAT), lê KB `PORTAL` |

## Entidades e regras

- **Chamado** (`SdTicket`): número sequencial por workspace
  (`SdSettings.nextTicketNumber`, incremento atômico), exibido como
  `<prefixo>-<número>` (`ticketPrefixes`, padrão INC/REQ/CHG/PRB). Campos:
  título, tipo, descrição (HTML sanitizado), canal, fase (+ % snapshot),
  impacto, urgência, prioridade (matriz ou manual), severidade, categoria >
  subcategoria > serviço, classificação, classificação da solução, solução,
  cliente, empresa, contato, CI, departamento, responsável, solicitante,
  participantes, pai/filhos, tags, campos customizados, SLA, campos de
  mudança e de problema, IA (resumo/triagem), CSAT.
- **Abertura**: aplica o modelo → matriz de prioridade → roteamento
  (serviço/subcategoria/categoria → departamento, senão o padrão) → fase
  inicial do tipo → política de SLA (condições por `position`, senão a do
  catálogo, senão a padrão) → prazos → round-robin (se ligado) → automações
  `TICKET_CREATED` → evento `ticket.created`.
- **Mudança de fase**: valida transição (se houver transições para o tipo),
  `requiredFields`, `requiresApproval` (aprovação APPROVED vigente),
  RESOLVED exige solução/classificação da solução se
  `requireSolutionOnResolve`, CLOSED exige assinatura se
  `requireSignatureOnClose`. Entrar em fase `pausesSla` pausa o relógio;
  sair retoma (soma minutos úteis pausados aos prazos). RESOLVED carimba
  `resolvedAt`; CLOSED/CANCELED carimba `closedAt`. Primeira mensagem
  pública de agente carimba `firstRespondedAt`.
- **SLA**: minutos úteis sobre `SdBusinessCalendar` (fuso, expediente por
  dia, feriados, 24×7). "Em risco" a partir de `slaAtRiskPercent`.
- **Escalonamento**: manual (funcional = outro departamento; hierárquico =
  líder / nível +1) ou automático por `SdEscalationRule` no tick do worker.
  As ações da regra podem chamar o **plantão** (`notifyOnCall`,
  `reassignToOnCall`): o chamado vai para quem está na camada do nível
  escalonado (1 no primeiro, 2 no seguinte…) e o aviso inclui a retaguarda.
  Dentro do expediente da escala, ou sem ninguém de plantão, vale o destino
  normal da regra — ninguém fica sem responsável.
- **Plantão (on-call)**: `SdOnCallSchedule` (departamento, fuso, rodízio
  DAILY/WEEKLY/BIWEEKLY, início do rodízio, hora da virada, calendário de
  expediente opcional) → `SdOnCallLayer` (1 = primeira chamada, 2 =
  retaguarda…) → `SdOnCallParticipant` (ordem do rodízio), mais
  `SdOnCallOverride` (troca pontual com período e motivo).
- **Automação**: `SdAutomationRule` (evento → condições → ações), avaliadas
  por `position`, com `stopProcessing`. Condições: `{field, operator, value}`
  com operadores `equals | not_equals | in | not_in | contains | is_empty |
  is_not_empty | gt | lt`.
- **Aprovação**: e-mail com link público `/servicedesk/approval/<token>`
  (token aleatório, guardado como SHA-256, expira), aprova/reprova com
  comentário; resposta vira evento + notificação + automação
  `APPROVAL_RESPONDED`.
- **Assinatura**: canvas → PNG no MinIO (bucket `servicedesk`), SHA-256 do PNG
  e de um snapshot do chamado.
- **Anexos**: MinIO bucket `servicedesk`, chave
  `<workspaceId>/tickets/<ticketId>/<cuid>-<nome>`; imagem, vídeo, áudio,
  documento; limite 25 MB.
- **Cliente/Empresa** (`SdCustomer`): nome, fantasia, PF/PJ, CPF/CNPJ
  (dígitos, validado, único por workspace entre não excluídos), e-mail,
  telefone, WhatsApp, endereço completo com ViaCEP. **Contato**: nome,
  cargo, e-mail, telefone, WhatsApp, uma ou mais empresas/clientes, usuário
  da plataforma opcional (chat interno/portal).
- **Departamentos**: dois níveis (departamento > sub-departamento); usuário
  em vários, com flag de líder.
- **Base de conhecimento**: port da Wiki do Nexo (Plate), árvore de artigos,
  rascunho/publicado, interno/portal, categoria, tags, votos de utilidade,
  vínculo com chamado.
- **Chamado recorrente** (`SdRecurringTicket`): rotina periódica
  (manutenção preventiva, limpeza, backup, vistoria, revisão de link) que
  abre chamado sozinha. Guarda os valores do chamado (`defaults`, mesma
  forma do modelo) + cliente, item de configuração, departamento e
  responsável, e a agenda: frequência (DAILY/WEEKLY/MONTHLY/YEARLY),
  intervalo, dias da semana (`byWeekday`, 0=domingo), dia do mês
  (`byMonthday`), horário (`atTime`), **fuso da regra**, vigência
  (`startsAt`/`endsAt`), antecedência (`leadTimeMinutes`) e `skipIfOpen`.
  Regras da agenda (lib pura `src/lib/servicedesk/recurrence.ts`): `atTime`
  é hora local do fuso da regra; o intervalo conta a partir de `startsAt`
  (semana começa no domingo); um dia do mês que não existe **cai no último
  dia do mês** (31 → 30/04, 28/02); hora local inexistente por mudança de
  fuso cai no primeiro instante depois do salto e hora ambígua vale a
  primeira passagem; sem ocorrência na vigência a agenda é recusada
  (`SD_RECURRING_SCHEDULE_INVALID`). Cada **ocorrência**
  (`SdRecurringTicketRun`) registra `CREATED` (com o chamado),
  `SKIPPED` (a anterior ainda aberta, com `skipIfOpen`) ou `FAILED` (código
  do erro); a unicidade `(recurringId, scheduledFor)` é a trava de
  idempotência do worker. O tick não faz backfill: abre no máximo uma
  ocorrência por regra e a agenda pula o atraso acumulado. "Gerar agora"
  ignora `skipIfOpen`, carimba `lastRunAt` e não consome a agenda.
- **Dashboards**: motor do CRM com `module = SERVICE_DESK` e fontes
  `sd-tickets` etc.; padrões "Analítico" e "KPIs (TV)" semeados; modo TV em
  tela cheia com auto-refresh.

## Motor de chamados (contratos para as outras fatias)

API (`app/api/workspaces/[id]/servicedesk/…`, OpenAPI em
`src/openapi/paths/servicedesk-tickets.ts`): `tickets` (GET lista/kanban
com filtros, POST abrir), `tickets/summary`, `tickets/bulk`,
`tickets/[ticketId]` (GET/PATCH/DELETE — `ticketId` aceita id, número ou
`INC-000123`), `…/phase`, `…/parent`, `…/participants[/userId]`,
`…/events` (rastreabilidade), `…/escalations`, `saved-views[/viewId]` e o
SSE `events`. Hooks: `src/hooks/use-sd-tickets.ts`.

Para as fatias que mexem no chamado (mensagens, tarefas, aprovações,
assinaturas, WhatsApp/IA):

- **Rastreabilidade**: `recordSdTicketEvent(event | event[])`
  (`src/services/sd-ticket-event-recorder.ts`) — `{ workspaceId, ticketId,
  actorKind, actorUserId?, action, field?, fromValue?, toValue?, meta? }`;
  relações como `{ id, label }`. Nunca lança.
- **Tempo real**: `publishSdTicketEvent(workspaceId, event, audience)`
  (`src/lib/servicedesk/realtime.ts`). Evento `{ type, ticketId, number,
  at, actorId?, internal? }` com `type` ∈ `ticket.created | ticket.updated
  | ticket.phase_changed | ticket.assigned | ticket.deleted |
  ticket.escalated | ticket.sla | ticket.participants | ticket.message |
  ticket.task | ticket.cost | ticket.part | ticket.attachment |
  ticket.approval | ticket.signature`. `audience = { requesterId,
  participantIds, contactUserId }` decide quais solicitantes recebem;
  `internal: true` (nota interna, custo) só vai para agentes. O evento é um
  aviso: o cliente recarrega pelas rotas.
- **Automação**: `runSdAutomations(event, ticketId, { actorId })` /
  `fireSdAutomations(…)` (`src/services/sd-automation-engine.ts`) — ex.:
  `MESSAGE_RECEIVED`, `APPROVAL_RESPONDED`. As ações não disparam novas
  automações (sem laço).
- **Motor** (`SdTicketEngine`, `src/services/sd-ticket-engine.ts`, sem
  autorização): `resolveRef`, `markFirstResponse(ticketId)` (1ª mensagem
  pública de agente), `touchActivity(ticketId)`, `reopen(ticket, actor,
  config)` (resposta do solicitante com `reopenOnRequesterReply`),
  `changePhase`, `update`, `loadConfig`. Visibilidade:
  `canViewSdTicket(ctx, ticket)`. HTML rico: `sanitizeSdHtml` /
  `sdHtmlToText` (`src/lib/servicedesk/html.ts`).
- **SLA**: `src/lib/servicedesk/sla.ts` (`addBusinessMinutes`,
  `businessMinutesBetween`, `computeSlaState`, `parseSdCalendar`). O tick
  `servicedesk-sla` (1 min) marca risco/violação uma única vez, notifica
  (responsável + líderes), roda `SdEscalationRule` e as automações
  `SLA_AT_RISK`/`SLA_BREACHED` e fecha RESOLVED vencidos.

## Plantão (contrato para as outras fatias)

Quem responde fora do horário sai de uma escala, não da boa vontade do líder
fixo do departamento.

- **Lib pura** `src/lib/servicedesk/oncall.ts`: `resolveSdOnCall(at,
  schedule, overrides)` devolve o responsável de cada camada;
  `sdOnCallPeriodAt`, `sdOnCallTimeline(schedule, overrides, from, to)`,
  `isWithinSdBusinessHours(at, calendar)` e `sdOnCallOverridesOverlap`. O
  rodízio é determinístico: a âncora é `handoffTime` no dia civil de
  `rotationStart`, no **fuso da escala**, e cada período é `[âncora + k·P,
  âncora + (k+1)·P)` contado em dias civis (sobrevive ao horário de verão e
  não depende do fuso do servidor). Troca vence o rodízio; camada sem
  participante devolve `userId: null`.
- **Sem autorização** (para quem já resolveu o acesso):
  `resolveSdOnCallForDepartment(workspaceId, departmentId, at)`,
  `sdOnCallEscalationTarget(workspaceId, departmentId, at, level)` e
  `sdOnCallNotifyUserIds(resolution, level)`
  (`src/services/sd-oncall-resolver.ts`). O target só vem quando a escala
  está valendo (`applies`: ativa **e** fora do expediente do calendário).
  A escala do departamento vem antes da escala geral do workspace
  (`departmentId = null`), que serve de rede.
- **Service** `SdOnCallService` (`list/get/create/update/remove`,
  `addLayer/updateLayer/removeLayer`, `setParticipants`,
  `listOverrides/createOverride/removeOverride`, `now`, `timeline`): admin do
  módulo mantém, agente consulta (`sd-oncall` × `VIEW`). Troca sobreposta na
  mesma camada responde `SD_ONCALL_OVERRIDE_OVERLAP`.
- **API** `app/api/workspaces/[id]/servicedesk/oncall/**`: `GET|POST /`,
  `GET|PATCH|DELETE /[scheduleId]`, `POST /[scheduleId]/layers`,
  `PATCH|DELETE /[scheduleId]/layers/[layerId]`, `PUT
  /[scheduleId]/layers/[layerId]/participants` (a **ordem do array é a ordem
  do rodízio**: adiciona, remove e reordena), `GET
  /[scheduleId]/timeline?from&days`, `GET /now?departmentId&at`, `GET|POST
  /overrides` e `DELETE /overrides/[overrideId]`.
- **UI**: aba "Plantão" das configurações (`oncall-tab.tsx`) e o selo
  `<SdOnCallBadge workspaceId departmentId />`
  (`app/_components/servicedesk/ticket/sd-oncall-badge.tsx`), que só aparece
  quando a escala está valendo. Hooks em `src/hooks/use-sd-oncall.ts`
  (`useSdOnCallSchedules`, `useSdOnCallOverrides`, `useSdOnCallTimeline`,
  `useSdOnCallNow`, `useSdOnCallMutations`).

## Notificações (central do módulo)

Um único motor avisa todo mundo: `notifySdEvent({ workspaceId, event,
ticket, actorId?, audience?, payload })`
(`src/services/sd-notification.service.ts`). O **catálogo**
`src/config/servicedesk-notifications.ts` (`SD_NOTIFICATION_EVENTS`) é o
contrato — chave do evento, tipo da notificação in-app
(`Notification.kind`), público, canais oferecidos, canais ligados por padrão
e o flag `agentOnly`. Evento novo entra lá (e num grupo de
`SD_NOTIFICATION_GROUPS`, que é a ordem da tela); chave fora do catálogo
devolve `SD_NOTIFICATION_EVENT_UNKNOWN`.

O que o motor faz, em ordem: resolve o público pelo catálogo (`assignee`,
`participants`, `followers`, `requester`, `contact`, `departmentLeads`,
`mentioned`) → soma `payload.userIds` → tira o autor (`actorId`), os
excluídos e os duplicados → evento `agentOnly` só segue para quem atende
(nunca solicitante nem contato externo) → cada canal respeita
`SdNotificationPreference` (sem linha = padrão do catálogo) → entrega
**IN_APP** (`Notification`, aparece em `/[slug]/inbox`), **EMAIL** (React
Email, respeita `MAIL_DRY_RUN`) e **WHATSAPP** (só com conexão do
ServiceDesk `CONNECTED`; sem conexão silencia com log). Nunca lança: falha
de canal vira log e o resto segue; só erro de banco vira `err`.

- `audience: 'payload'` ignora o público do catálogo e usa apenas
  `payload.userIds` — é o caso da ação "notificar" das automações, do
  pedido de aprovação e da tarefa atribuída, em que quem dispara já
  escolheu os destinatários.
- Monte o `ticket` com `sdNotifyTicketOf(ticket, code)`
  (`src/lib/servicedesk/notify.ts`, puro — não puxa o service).
- **Seguir chamado** (`SdTicketFollower`): `SdTicketFollowerService`
  (list/follow/unfollow, sempre em nome de quem chamou, idempotente) e
  `GET|POST|DELETE .../servicedesk/tickets/[ticketId]/followers`. Quem segue
  entra no público `followers`.
- **Menções**: `SdTicketMessage.mentionedUserIds` (coluna nova) guarda os
  agentes citados com `@` no composer; o service filtra para agentes do
  workspace e dispara `ticket.mentioned`.
- **Preferências por usuário**: `SdNotificationService.get/update/
  restoreDefaults` e `GET|PUT|DELETE
  .../servicedesk/notification-preferences`; tela na aba "Notificações" de
  `/settings`. Não há visão de administrador — cada um configura a sua.
- **Resumo diário** (`digest.daily`, desligado por padrão): fila
  `servicedesk-digest` (de hora em hora; `SdDigestService.runTick` só envia
  aos workspaces cuja hora local é `SD_DIGEST_HOUR`, o que dá um envio por
  dia sem carimbo de controle — por isso a fila usa `attempts: 1`). Fila
  vazia não gera resumo.
- A antiga flag "enviar e-mail" das regras de escalonamento e da ação
  "notificar" das automações **não força mais e-mail**: o canal é a
  preferência de cada destinatário (o valor da regra vai para o log como
  `ruleEmail`).

## Painel IA vs. técnico (S9)

Compara o que a IA sugeriu com o que o técnico fez, para medir a precisão e
justificar a cota de IA. Só leitura: nada chama a IA.

- **Fontes.** A triagem automática já grava `SdTicket.aiTriage` (sugestões +
  campos aplicados). O copiloto passou a gravar cada rascunho entregue em
  `sd_ai_suggestions` (`SdAiSuggestion`: `REPLY`, `SOLUTION` ou
  `CLASSIFICATION`, com texto ou payload) via `SdAiRepository.recordSuggestion`,
  em melhor esforço: falhar ao gravar nunca derruba a sugestão. Consumo vem de
  `ai_usage` (`SERVICEDESK_*`) e o pré-atendimento de `sd_ai_conversations`.
- **Regras** (`src/lib/servicedesk/ai-comparison.ts`, puras): campo sugerido ×
  valor final do chamado (`APPLIED_KEPT`, `APPLIED_CHANGED`, `AGREED`,
  `DISAGREED`); só chamados `RESOLVED`/`CLOSED` entram na precisão (cancelados
  ficam fora, em andamento contam como "aguardando o técnico"); a prioridade é
  ignorada quando a IA aplicou impacto ou urgência (a matriz a recalcula);
  texto por similaridade de Sørensen-Dice sobre palavras (sem acento, sem HTML):
  `>= 0,8` adotada, `>= 0,35` editada, abaixo disso não usada; sem texto do
  agente a sugestão fica pendente por 24 h (solução: enquanto o chamado estiver
  aberto). Uma classificação conta como aproveitada quando metade dos campos
  coincide.
- **Camadas.** `GET /api/workspaces/[id]/servicedesk/ai/comparison?days=7|30|90`
  → `SdAiComparisonService.overview` → `SdAiComparisonRepository`. Permissão
  `sd-reports` (VIEW) e só agente. Tela `/ai-comparison`
  (`SdAiComparisonPanel`, hook `useSdAiComparison`).
- **Limites conhecidos.** A amostra de cada leitura é limitada a 5.000 linhas
  por consulta; sugestões anteriores à migração não existem (só a triagem tem
  histórico); similaridade de texto é uma heurística, não um juízo semântico.

## Risco preditivo (contrato para as outras fatias)

Heurística explicável, **sem LLM** ([ADR 0016](../adr/0016-predictive-risk-explainable-heuristic.md)):
a nota sai de uma tabela de pesos versionada e **nunca aparece sem o motivo**.

- **Tabela** `src/lib/servicedesk/risk.ts`: os nove fatores (soma 100), as
  faixas (`MEDIUM` ≥ 40, `HIGH` ≥ 70), rótulos e cores.
- **Lib pura** `src/lib/servicedesk/risk-compute.ts`:
  `computeSdRiskPrediction(ticket, stats, now, { atRiskPercent, calendar })`
  devolve `{ level, score, factors, breachEtaAt }`. Cada fator que pega soma
  **entre 1 e o seu peso** (contribuição graduada onde o sinal é contínuo) e
  leva a frase em pt-BR que a tela mostra. `sdRiskBreachEta` consome os
  minutos úteis restantes no calendário de expediente — 30 minutos úteis às
  17h50 de uma sexta caem na segunda. Os cortes estão em `SD_RISK_TUNING`
  (ajustar peso ou corte não exige migração).
- **Prazo que pesa**: a resolução entra sempre que tem prazo; a **1ª
  resposta** entra enquanto ninguém respondeu. O fator `sla_consumed` usa o
  timer mais urgente (violado vence qualquer porcentagem; empate fica com a
  resolução) e `breachEtaAt` é o **primeiro** prazo a estourar.
- **"Sem interação da equipe"** (`stale`) mede o tempo desde o último evento
  **de agente** (`SdRiskRepository.lastTeamActivityByTicketIds`, eventos com
  `actorKind = AGENT`), não `SdTicket.lastActivityAt` — este também anda com
  mensagem do cliente pelo portal, e-mail ou WhatsApp. Se a equipe nunca agiu,
  conta desde a abertura.
- **Régua do workspace** (`SdRiskWorkspaceStats`): fila por departamento,
  carga por responsável, topo das escalas de prioridade/severidade e o
  histórico de violação por cliente/serviço. É o que torna "fila cheia"
  comparável entre um time de 3 e um de 30.
- **Agrupamento** `src/lib/servicedesk/incident-cluster.ts`:
  `sdIncidentSignature` = `categoria:subcategoria:serviço:termos`, com os
  termos do título normalizados (sem acento, sem palavra de ligação, sem
  número). Quando há mais de 4 termos (`SD_CLUSTER_MAX_TERMS`), ficam os
  **mais relevantes**: primeiro o que se repete no título, depois o que
  aparece em mais incidentes da janela (`sdIncidentTermFrequencies`), e a
  ordem alfabética só desempata; os escolhidos são **ordenados** — "Servidor
  de e-mail fora do ar" e "E-mail fora do ar no servidor" caem no mesmo
  grupo. `sdGroupIncidents` só devolve grupo com **3+ incidentes**
  (`SD_CLUSTER_MIN_TICKETS`) na janela de **7 dias**.
- **Service** `SdRiskService`: `recomputeTick({ workspaceId? })` (fila
  `servicedesk-risk`, a cada 10 min) grava uma linha por chamado aberto
  (`SdTicketRiskPrediction`, upsert) e apaga a dos encerrados; avisa
  `sla.breach_predicted` **só quando o chamado entra** na faixa alta (nunca a
  cada tick). `scanClusters` (de hora em hora) grava as sugestões e avisa
  `problem.cluster_detected` aos líderes na primeira detecção. Leitura:
  `listTickets`, `getTicketRisk`, `listClusters`; ações do agente:
  `openProblem` (abre o PROBLEM pelo motor, vincula os incidentes sem pai
  como filhos e carimba `problemTicketId`) e `dismissCluster`. Uma sugestão
  descartada só volta se repetir 3 vezes **depois** do descarte.
- **API** `app/api/workspaces/[id]/servicedesk/risk/**`: `GET /tickets`
  (fila por risco), `GET /tickets/[ticketId]`, `GET /clusters`,
  `POST /clusters/[clusterId]/problem`, `POST /clusters/[clusterId]/dismiss`.
  Tudo com a permissão do chamado (`sd-tickets`) e só para agentes.
- **Backtest** (`pnpm risk:backtest [workspaceIdOuSlug] [--days=90]
  [--limit=2000]`, script `scripts/risk-backtest.ts`, lib pura
  `src/lib/servicedesk/risk-backtest.ts`): reproduz a heurística sobre os
  chamados **encerrados** com desfecho de SLA conhecido e imprime
  calibração por faixa, precisão/revocação da faixa alta e antecedência. Ver
  a seção "Backtest do risco" abaixo.
- **Para quem desenha chamado**: a previsão viaja **dentro do chamado**
  (`SdTicketDTO.risk`, `null` para solicitante) e a lista aceita
  `?riskLevel=HIGH`. Selo pronto:
  `app/_components/servicedesk/risk/sd-risk-badge.tsx`
  (`SdRiskBadge`, `SdRiskWidget`, `SdRiskFactorList`). Hooks:
  `src/hooks/use-sd-risk.ts`.

### Backtest do risco

Mede se a heurística acerta, com os chamados que já encerraram. **Só lê o
banco** (nada é gravado), mas lê dado de cliente: rode no servidor, contra
o banco do ambiente que quer medir, nunca copiando a base para outra máquina.

```bash
pnpm risk:backtest                    # todo workspace com o ServiceDesk ligado
pnpm risk:backtest acme               # um workspace (id ou slug)
pnpm risk:backtest acme --days=180 --limit=5000
```

Como funciona: para cada chamado encerrado nos últimos `--days` dias que
tinha prazo de 1ª resposta ou de resolução (até `--limit` por workspace), o
script tira **três fotos** — a 25%, 50% e 75% do caminho entre a abertura e
a violação (ou o encerramento, se cumpriu) — e roda
`computeSdRiskPrediction` com o que já tinha acontecido naquele instante:
1ª resposta, responsável (desde a primeira atribuição registrada), último
evento de agente e reaberturas. O desfecho é "violou" quando a flag de
violação foi gravada ou a conclusão passou do prazo.

O relatório traz:

- **Calibração por faixa** — fotos, violadas e taxa real de violação de
  cada faixa. Uma heurística bem calibrada mostra a taxa subindo de baixo
  para alto.
- **Faixa alta como alarme** — precisão (das fotos em alto, quantas eram de
  chamado que violou) e revocação (das fotos de chamado que violou, quantas
  estavam em alto), por foto.
- **Antecedência** — por chamado violado, o tempo entre a primeira foto em
  alto e a violação (mínima, mediana, média, máxima), e quantos violados
  passaram pelo alto antes.

Limites da reconstrução (o histórico do chamado não é versionado): fase e
pausa de SLA não são reproduzidas (a foto assume fase em andamento com o
relógio correndo), e fila/carga são recontadas só com os chamados da
amostra — os fatores `waiting_third_party`, `queue_pressure` e
`assignee_load` saem subestimados. A matemática das métricas tem teste
unitário em `src/lib/__tests__/servicedesk-risk-backtest.test.ts`.

## Swarming de especialistas (S6)

Chama especialistas para dentro do chamado **sem passar pelos níveis
N1/N2/N3** do escalonamento. Aba **Swarming** na tela do chamado (só agentes e
convidados; o portal não a mostra).

- **Modelo**: `SdSwarm` (um por chamado aberto; histórico dos encerrados) e
  `SdSwarmMember` (`INVITED` → `JOINED` ou `DECLINED`). Migration
  `nov_s6_swarming_tables`. Teto de 10 especialistas por swarming
  (`SD_SWARM_MAX_MEMBERS`, `src/lib/servicedesk/swarm.ts`).
- **Fluxo** (`SdSwarmService`): *abrir* (agente; motivo + 1 a 10 especialistas
  + opção de canal no Slack) → cada convidado vira **participante** do chamado
  e recebe `swarm.invited` (in-app e e-mail) → o convidado *entra* ou *recusa*
  (`swarm.responded` avisa quem abriu) → *convidar mais* (quem recusou é
  convidado de novo) → *encerrar* (resumo no histórico). Tudo vira evento de
  rastreabilidade (`swarm.started|invited|joined|declined|closed`) e auditoria
  (`sd_swarm`). Não há mudança de responsável nem de fase: o dono do chamado
  continua o mesmo.
- **Quem pode**: abrir, convidar e encerrar são de agentes; listar e responder
  também do convidado (membro do workspace, mesmo sem departamento). Chamado
  fechado ou cancelado não abre swarming, mas ainda dá para encerrar um aberto.
- **Slack (opcional)**: com o Slack conectado em Ajustes > Integrações, a
  abertura oferece um **canal privado temporário** (`swarm-<código>`, ex.:
  `swarm-inc-000123`). O bot cria o canal, convida os especialistas cujo
  e-mail existe no Slack (`users.lookupByEmail`) e posta o motivo com o link do
  chamado. Ao encerrar, posta o resumo e **arquiva** o canal. Falha do Slack
  nunca impede o swarming: o motivo fica em `slackError` e aparece na aba.
  Código em `sd-swarm-slack.ts`; métodos novos em `slack-client.ts`
  (`createChannel`, `inviteToChannel`, `archiveChannel`, `lookupByEmail`).
- **Rotas**: `GET|POST .../tickets/{ticketId}/swarms` e
  `POST .../swarms/{swarmId}/{invite|respond|close}`; contrato em
  `src/openapi/paths/servicedesk/swarm.ts`.
- **Fora desta fatia**: o canal do Slack não espelha a conversa do chamado (o
  espelho de thread é o das integrações); não há SLA nem fila de swarmings.

## Inventário e descoberta de ativos (S1)

A CMDB deixa de depender de cadastro manual: um **agente** nas máquinas e uma
**varredura SNMP** do worker alimentam o inventário, e o inventário mantém os
itens de configuração. Decisões da fatia (sem ADR próprio para não colidir na
numeração; viram ADR se a equipe quiser):

- **Agente em Go** (`inventory-agent/`, só biblioteca padrão, um binário por
  sistema). Linux lê `/proc`, `/sys/class/dmi`, `statfs` e `dpkg`/`rpm`;
  Windows roda **um** PowerShell (`-EncodedCommand`) com CIM e o registro de
  desinstalação. Identidade estável = SHA-256 do `machine-id` (Linux) ou
  `MachineGuid` (Windows), então reinstalar não duplica a máquina. Instala
  como serviço systemd (Linux) ou tarefa agendada (Windows); o CI
  (`.github/workflows/inventory-agent.yml`) formata, testa e cruza a build.
  **Assinatura de código do Windows** é decisão pendente do negócio (ver
  roadmap): os binários saem sem assinar e o SmartScreen avisa.
- **Token por workspace** (`SdInventoryToken`): 32 bytes em base64url, só o
  SHA-256 no banco, valor mostrado **uma única vez**, revogável na hora. Vai em
  `Authorization: Bearer`. Entrada pública `POST /api/servicedesk/inventory/report`
  (em `PUBLIC_ROUTES`), com rate limit por IP e corpo de até 2 MB. Um token vale
  para N máquinas; o equipamento é a chave `(workspace, externalKey)` com
  `externalKey = agent:<agentId>`.
- **Varredura SNMP v2c** (`servicedesk-inventory`): `scan-due` a cada 5 min
  reserva (`nextRunAt` +30 min) e enfileira os alvos vencidos; `scan-target`
  varre as faixas (CIDR/IP, até 1.024 endereços por alvo), lê sysDescr/sysName,
  HOST-RESOURCES (memória, discos, software), MIB-II (MACs) e ENTITY (série,
  modelo, fabricante) e grava via o mesmo `syncInventoryDevice`. A community
  fica cifrada com `CONNECTION_SECRETS` e nunca volta pela API. Chave do
  equipamento SNMP: série, senão o primeiro MAC, senão o IP (DHCP não duplica).
  Host mudo não é falha; falha é erro de socket ou de gravação, e vira
  `PARTIAL`/`FAILED` no alvo (`lastStatus`/`lastError`).
- **CMDB** (`syncInventoryDevice`): o item ligado ao equipamento é atualizado
  (série, fabricante, modelo, IP — **nunca** nome, status, dono ou
  criticidade); sem item, o inventário **adota** um item manual com o mesmo
  número de série ainda sem equipamento, ou cria um no tipo escolhido nos
  ajustes (padrão "Computador" para o agente e "Equipamento de rede" para o
  SNMP). Se o item for excluído na CMDB, o próximo relatório cria outro.
  Desligável em Configurações > Inventário ("Manter a CMDB atualizada").
- **Alertas de disco e RAM** (`SdInventoryAlert`, uma linha por equipamento ×
  tipo × volume): abre ao passar do limiar (padrão 90%, 50–100%), atualiza o
  percentual, **fecha sozinho** ao normalizar, reabre se repetir e fecha o de
  um volume que sumiu. Hoje aparecem na tela e no contador; **abrir chamado a
  partir do alerta é a fatia S3** (Monitoramento → chamado automático).
- **Software**: a lista do agente é substituída por inteira a cada relatório
  (`SdInventorySoftware`); o catálogo agrupa por nome × versão com a contagem de
  equipamentos — é a base da gestão de licenças (S7). O SNMP só substitui a
  lista quando o equipamento expõe `hrSWInstalled`.
- **Sem sinal**: derivado de `lastSeenAt` × `staleAfterDays` (padrão 7 dias);
  não há job de varredura nem mudança automática do status do item.
- **Fora do escopo desta entrega**: SNMP v3, descoberta por ARP/ping, ligar o
  mesmo computador visto pelo agente e pelo SNMP num só equipamento, atualização
  automática do agente e distribuição dos binários pelo app (hoje são
  artefatos do workflow).

Contrato: `src/services/sd-inventory-{sync,ingest,token,settings,target}.service.ts`
e `sd-inventory.service.ts` (consultas); `syncInventoryDevice(workspaceId,
actorId, input, now?)` é o ponto único de gravação; API em
`servicedesk/inventory/**`; hook `src/hooks/use-sd-inventory.ts`.

## Rotas de UI

| Rota (`/[slug]/servicedesk/…`) | Tela |
| ------------------------------ | ---- |
| `/` | início (minha fila, KPIs rápidos, SLA em risco) |
| `/portal`, `/portal/new`, `/portal/tickets/[number]` | portal do solicitante (+ pré-atendimento IA) |
| `/tickets`, `/incidents`, `/requests`, `/changes`, `/problems` | quadro kanban / lista / tabela com filtros e visões salvas |
| `/changes/calendar` | calendário de mudanças (mês/semana): janelas de manutenção e congelamento como faixas de fundo, mudanças pela janela planejada, conflitos destacados e painel do dia |
| `/tickets/[number]` | tela do chamado (abas: Histórico, WhatsApp, Tarefas, Custos, Aprovação, Mudança — só em `CHANGE` —, Peças, Itens filhos, Escalonamento, Rastreabilidade, Assinatura, Conhecimento) |
| `/customers`, `/companies`, `/contacts`, `/config-items` | cadastros |
| `/tickets/[number]` | tela do chamado (abas: Histórico, WhatsApp, Tarefas, Horas, Custos, Aprovação, Peças, Itens filhos, Escalonamento, Rastreabilidade, Assinatura, Conhecimento) |
| `/customers`, `/companies`, `/contacts`, `/config-items` | cadastros (o cliente tem a aba Contrato, com o consumo do período) |
| `/knowledge`, `/knowledge/[articleId]` | base de conhecimento |
| `/ai-comparison` | painel IA vs. técnico: precisão da triagem e do copiloto, aproveitamento por agente, pré-atendimento e consumo da cota |
| `/risk` | análise de risco: fila por risco (faixa alta/média/baixa) e sugestões de problema a partir de incidentes repetidos |
| `/inventory` | inventário de ativos: equipamentos (com detalhe de hardware, discos e software), alertas de disco/RAM e catálogo de software |
| `/dashboards`, `/dashboards/[id]`, `/dashboards/[id]/tv` | painéis |
| `/settings` | configurações (abas; "Recorrentes" = rotinas preventivas) |
| `/servicedesk/approval/[token]` (pública, fora do workspace) | aprovar/reprovar |

Contrato compartilhado já pronto (fundação): `src/services/sd-access.ts`,
`src/schemas/sd-rule.schema.ts` (condições e ações das regras).

## Mapa do código por fatia

| Fatia | Arquivos |
| ----- | -------- |
| config | `sd-settings`, `sd-department`, `sd-category`, `sd-classification`, `sd-priority` (impacto, urgência, prioridade, matriz, severidade), `sd-phase` (+ transições), `sd-calendar`, `sd-sla-policy`, `sd-escalation-rule`, `sd-automation-rule`, `sd-custom-field`, `sd-ticket-template`, `sd-canned-response`, `sd-part`, `sd-seed.service.ts`, `sd-access.ts`, tela `/settings` |
| tickets | `sd-ticket`, `sd-ticket-participant`, `sd-ticket-event`, `sd-ticket-escalation` (service manual + automático), `sd-saved-view`, `src/lib/servicedesk/{sla,conditions,ticket-code,realtime}.ts`, SSE `servicedesk/events`, motor de automação, fila `servicedesk-sla` |
| directory | `sd-customer`, `sd-contact`, `sd-config-item` (+ tipos), `src/lib/servicedesk/{document,viacep}.ts`, telas de cadastro |
| knowledge | `sd-kb-article`, `sd-kb-comment`, editor Plate, telas `/knowledge` |
| ticket-ui | quadros, filtros, visões salvas, tela do chamado (casca + cabeçalho + campos), início |
| ticket-tabs | `sd-ticket-message`, `-attachment`, `-task`, `-cost`, `-part`, `-approval`, `-signature`, abas do chamado (a de Escalonamento usa o service da fatia tickets), página pública de aprovação |
| whatsapp-ai | conexão WhatsApp do módulo, webhook → chamado, aba WhatsApp, `sd-ai*` (copiloto, pré-atendimento, triagem) |
| notifications | `src/config/servicedesk-notifications.ts`, `sd-notification` (schema/mapper/repository/service = motor + preferências), `sd-ticket-follower.service.ts`, `sd-digest.service.ts`, `src/lib/servicedesk/notify.ts`, fila `servicedesk-digest`, aba "Notificações", botão Seguir, menções no composer |
| dashboards-portal | fontes do dashboard, seeds Analítico/KPIs, modo TV, portal do solicitante |
| monitoring | `sd-monitor-source`, `sd-monitor-alert`, `src/lib/servicedesk/{monitoring,monitor-fields}.ts`, entrada pública `servicedesk/monitoring/[token]`, aba Monitoramento das configurações, bloco de origem na tela do chamado, aba Monitoramento do item da CMDB, fila "Hosts sem item" (`monitor-alerts/[alertId]`) |
| oncall | `sd-oncall` (schema/mapper/repository/service), `sd-oncall-resolver.ts`, `src/lib/servicedesk/oncall.ts`, API `servicedesk/oncall/**`, aba "Plantão", selo `SdOnCallBadge`, e as ações `notifyOnCall`/`reassignToOnCall` do escalonamento |
| recurring | `sd-recurring-ticket` (schema/mapper/repository/service) + `sd-recurring-ticket-runner.ts`, `src/lib/servicedesk/recurrence.ts`, fila `servicedesk-recurring`, aba Configurações > Recorrentes, aba "Rotinas" do item de configuração |
| change-cab | `sd-change-window`, `sd-change-schedule.ts` (gancho de congelamento/conflito no `SdTicketEngine.update`), `sd-cab-board`, `sd-approval-round`, `sd-approval-gate.ts` (fase com `requiresApproval` aceita rodada aprovada), `sd-ticket-change-schedule.service.ts`, `src/lib/servicedesk/change-calendar.ts` (expansão pura da recorrência), tela `/changes/calendar`, aba "Mudanças" das configurações e aba "Mudança" do chamado |
| mail | `sd-mailbox`, `sd-mail-inbound`, `sd-mail-outbound`, `sd-mail-credentials`, `src/lib/servicedesk/{mail-text,mail-queue}.ts`, `src/lib/mail/sd-mailbox-transport.ts`, fila `servicedesk-mail`, aba Configurações > E-mail, marcador de e-mail no histórico |
| contratos e horas | `sd-contract` (schema/mapper/repository/service), `sd-contract-period.repository.ts`, `sd-contract-billing.service.ts` (períodos e consolidação), `sd-contract-stamp.ts` (gancho do motor), `sd-time-entry` (schema/mapper/repository/service), `src/lib/servicedesk/billing.ts`, fila `servicedesk-billing`, aba Configurações > Contratos, aba "Horas" do chamado, bloco Contrato na tela do cliente |
| inbox | `notification` (schema/mapper/repository/service da caixa), `app/_components/notifications/*` (lista, painel de leitura, ícone por tipo), `src/lib/notification-kind.ts` (tabela pura de tipo → rótulo/ícone/cor), rota `/inbox` |
| relatórios agendados | `sd-report` (schema/mapper/repository/service — `SdScheduledReport` + `SdReportRun`) + `sd-report-runner.ts` (geração sem autorização, compartilhada com a fila), `src/lib/servicedesk/{report-sla,report-schedule,report-csv,report-files}.ts` e `report-pdf.tsx`, `src/lib/mail/servicedesk/send-sd-sla-report.ts` + `components/emails/servicedesk/sd-sla-report.tsx`, fila `servicedesk-reports`, API `servicedesk/reports/**`, aba Configurações > Relatórios e o histórico de execuções |
| kcs | `sd-kb-review` (schema/mapper/repository/service), `sd-kb-draft.service.ts` (artigo a partir do chamado, com rascunho da IA), `src/lib/servicedesk/kcs.ts` (esqueleto KCS, prompt e aritmética da validade), `markResolved`/`suggestForDraft` em `sd-kb-ticket-link.service.ts`, rotas `servicedesk/knowledge/{reviews,review-settings,stats,draft,suggest/draft}` e `knowledge/[articleId]/{reviews,review-interval,resolved}`, painel `SdKbReviewPanel`, `SdKbCuration`, `SdKbDraftSuggestions`, checagem diária no tique do `servicedesk-digest` |
| inventory | `sd-inventory-*` (token, settings, sync, ingest, target, consultas) + repositórios/mapper/schema, `src/lib/servicedesk/{inventory,snmp}.ts`, fila `servicedesk-inventory`, entrada pública `servicedesk/inventory/report`, tela `/inventory`, aba Inventário das configurações, agente em `inventory-agent/` |
| risco preditivo | `src/lib/servicedesk/risk.ts` (tabela de fatores e faixas — ADR 0016), `risk-compute.ts` e `incident-cluster.ts` (libs puras), `sd-risk.{schema,mapper,repository,service}`, fila `servicedesk-risk`, API `servicedesk/risk/**`, selo `SdRiskBadge`/`SdRiskWidget` no quadro, na lista, na tabela e na tela do chamado, filtro rápido "Risco alto", tela `/risk` |
| integrações | conexões do workspace em `workspace-integration` (repository/schema/mapper/service, ADR 0024) e `src/lib/integrations/*`; no módulo: `sd-integration` (schema/mapper/repository dos vínculos), `sd-integration.service.ts` (configurações do módulo), `sd-integration-link.service.ts` (vínculos do chamado, GitHub e GitLab), `sd-integration-dispatcher.ts` (saída para o Slack), `sd-slack-inbound.service.ts`, `sd-github-webhook.service.ts` (+ `SdGithubSyncService`), `sd-gitlab-webhook.service.ts`, `sd-integration-credentials.ts`, `src/lib/servicedesk/{integrations,integrations-queue,slack-client,slack-oauth-state,github-client}.ts`, `src/cache/sd-integration-event.cache.ts`, fila `servicedesk-integrations`, aba Configurações > Integrações, bloco Integrações na tela do chamado |

## Operação

- **Ligar o módulo**: o admin global libera `SERVICE_DESK` no painel
  (`/admin/workspaces/[id]/module-access`). Isso dispara o seed ITIL
  (`SdSeedService`) e os dois dashboards padrão
  (`SdDashboardSeedService`) — ambos idempotentes. Para workspaces antigos:
  `pnpm seed:servicedesk`.
- **Primeiros passos no workspace**: Configurações > Departamentos (coloque
  os agentes num time — quem não está em nenhum vira solicitante) →
  Catálogo → SLA → Fluxos, se quiser mudar as fases. O resto já vem semeado.
- **Filas do worker**: `servicedesk-sla` (1 min: risco/violação,
  escalonamento, automações de SLA e fechamento automático de resolvidos),
  `servicedesk-ai` (triagem automática na abertura, quando ligada),
  `servicedesk-mail` (1 min: leitura das caixas por IMAP),
  `servicedesk-digest` (de hora em hora; manda o resumo diário a quem optou,
  na hora local do workspace, e no mesmo tique avisa os artigos da base
  com revisão vencida), `servicedesk-recurring` (5 min: abre os
  chamados das rotinas recorrentes vencidas, idempotente por ocorrência),
  `servicedesk-billing` (00:20: abre o período do ciclo de cada contrato
  ativo e fecha o anterior, consolidando as horas), `servicedesk-reports`
  (de hora em hora, :10: enfileira e gera os relatórios de SLA agendados,
  idempotente por `(reportId, periodStart)`) e `servicedesk-risk` (10 min:
  recalcula o risco preditivo dos chamados abertos; de hora em hora, :25,
  agrupa os incidentes repetidos da janela). A fila `servicedesk-integrations` leva os eventos ao canal do Slack (`deliver-event`) e reconcilia o estado das issues/PRs (GitHub) e issues/MRs (GitLab) vinculadas (`sync-github-state`, de hora em hora às :40). A fila `servicedesk-task-reminders` (a cada 15 min) avisa o responsável de cada tarefa uma vez quando ela vence em menos de 1 hora e uma vez quando venceu (evento `task.due`; carimbos `dueSoonNotifiedAt`/`overdueNotifiedAt` na tarefa, rearmados quando o prazo muda; prazos vencidos há mais de 24 h não são anunciados).
- **Notificações**: Configurações > Notificações é a tela de **cada
  usuário** (não é configuração do workspace). O canal WhatsApp só aparece
  quando existe conexão do ServiceDesk ativa. "Restaurar padrões" apaga as
  escolhas e volta ao catálogo.
- **WhatsApp**: Configurações > WhatsApp cria a conexão do módulo
  (`WhatsAppConnection.module = SERVICE_DESK`, separada da do zap) e aponta a
  ativa em `SdSettings.whatsappConnectionId`. O webhook já roteia mensagens
  para o chamado aberto da conversa, ou abre um novo (ou entrega ao
  pré-atendimento da IA, se ligado). A resposta com o código ao contato
  depende de `SdSettings.whatsappSendAcknowledgement` (Configurações >
  WhatsApp > Mensagens automáticas, ligada por padrão) — independente da
  confirmação por e-mail, que é por caixa.
- **E-mail**: Configurações > E-mail cadastra as caixas (`SdMailbox`: IMAP
  obrigatório, SMTP opcional, senhas cifradas com `CONNECTION_SECRETS`).
  A cada minuto o worker lê o que chegou desde `lastSeenUid` e, por mensagem:
  dedupe por `(mailboxId, Message-ID)` → listas de remetentes e limite por
  hora → resposta automática/devolução (`Auto-Submitted`, `X-Autoreply`,
  `Precedence: bulk`, `Return-Path` vazio) fica registrada em `SdMailMessage`
  com `automatic` e não abre nem reabre chamado → `In-Reply-To`/`References`
  (ou o código no assunto) viram mensagem no histórico do chamado (canal
  EMAIL, autor CONTACT quando o e-mail casa com um contato) → senão abre
  chamado com os padrões da caixa, criando o contato se
  `createUnknownContacts`. O corpo chega limpo (sem citação nem assinatura,
  `src/lib/servicedesk/mail-text.ts`) e os anexos vão para o bucket
  `servicedesk` como anexos do chamado. Com `sendAcknowledgement`, o
  remetente recebe o código de volta. A resposta **pública** de um agente no
  histórico sai pela caixa (SMTP próprio ou a camada de e-mail do Steel com
  `Reply-To` da caixa), encadeada e com o código no assunto; `MAIL_DRY_RUN`
  registra sem enviar.
- **IA**: Configurações > IA liga copiloto, triagem e pré-atendimento. Usa o
  provedor e a cota do workspace (ADR 0007); sem chave ou com cota estourada,
  a interface explica em vez de falhar silenciosamente.
- **Monitoramento**: Configurações > Monitoramento cria a origem (Zabbix ou
  webhook genérico). O token da URL pública é sorteado na criação, **aparece
  uma única vez** e fica guardado só como SHA-256 (`SdMonitorSource.tokenHash`);
  perdeu, gere outro — o anterior deixa de valer na hora. No Zabbix: Alertas >
  Tipos de mídia > novo **Webhook** com a URL, método POST e o JSON das macros
  (`{EVENT.ID}`, `{EVENT.VALUE}`, `{EVENT.STATUS}`, `{EVENT.NAME}`,
  `{EVENT.SEVERITY}`, `{EVENT.DATE}`, `{EVENT.TIME}`, `{EVENT.TAGS}`,
  `{HOST.NAME}`, `{HOST.IP}`, `{ALERT.MESSAGE}` — a tela mostra o corpo pronto
  para copiar). Um webhook próprio pode mandar
  `{ externalId, status, severity, host, subject, body, tags, startedAt }`.
  A entrada deduplica por `(origem, externalId)`: o mesmo alerta reenviado
  atualiza a linha e não abre um segundo chamado. PROBLEM abre o chamado com os
  padrões da origem (tipo, departamento, categoria, cliente), prioridade pelo
  mapa severidade → prioridade, canal `API` e ator de sistema, casando o host
  com o item de configuração (nome, código ou IP). OK/RESOLVED fecha o alerta e,
  com `autoResolve`, move o chamado para a fase RESOLVED do tipo com a solução
  automática; se a fase exigir algo que o monitoramento não preenche (campos
  obrigatórios, aprovação, classificação da solução), o chamado recebe uma
  mensagem pública explicando em vez de ser encerrado. O mesmo alerta voltando
  dentro de `flappingWindowMinutes` reabre o chamado anterior.

  **S3 — Grafana, PRTG, correlação e CMDB** (`SdMonitorKind` ganhou `GRAFANA`
  e `PRTG`; manual em `content/docs/servicedesk/monitoramento.mdx`):
  - *Formatos*: `parseSdMonitorEvents(kind, corpo)` devolve uma lista de
    eventos. `alerts[]` (Grafana unificado e Alertmanager) vale para qualquer
    tipo de origem e processa até 50 alertas por envio, em ordem; cada um
    guarda no alerta só o seu pedaço do corpo. PRTG manda um sensor por envio
    (`sensorId` é a chave; `Up`/`OK` normaliza; a hora do PRTG é ignorada
    porque vem no fuso do servidor dele). A resposta tem o primeiro alerta nos
    campos de sempre e `alerts[]` quando o envio trouxe mais de um. Um erro
    interrompe o lote; reenviar é seguro (deduplicação).
  - *Deduplicação*: `(origem, externalId)` continua único; o reenvio soma
    `occurrences` e atualiza `lastSeenAt`. Grafana usa o `fingerprint`; sem
    ele, o hash do `alertname` + rótulos ordenados.
  - *Correlação* (`SdMonitorSource.correlationMode` = `HOST`, janela em
    `correlationWindowMinutes`, padrão 60): a chave é `ci:<id>` quando o host
    casou com a CMDB, senão `host:<primeiro rótulo em minúsculas>`. Alerta novo
    sem linha anterior, com chave, procura um alerta **aberto** (qualquer
    origem da workspace) com a mesma chave, atividade (`lastSeenAt`) dentro da
    janela e chamado ainda não encerrado, e entra nesse chamado
    (`correlated = true`, nota interna, evento `monitor.alert_correlated`,
    resultado `alert_correlated`). O chamado só é resolvido quando o último
    alerta aberto dele normaliza (`countOpenByTicket`); se a contagem falhar,
    por segurança o chamado não é encerrado. Origens existentes ganharam
    `HOST` na migração.
  - *CMDB*: o casamento tenta, na ordem, o apelido guardado
    (`SdMonitorHostAlias`, por workspace), nome/código/IP de cada nome do
    alerta (`host` + `hostAliases`) e o primeiro rótulo de um FQDN. Alertas
    sem item aparecem em "Hosts sem item na CMDB"; `PATCH
    monitor-alerts/[alertId]` liga (com `remember`, guarda o apelido e liga os
    abertos com o mesmo host) ou desliga, e o chamado herda o item se não
    tinha. `GET monitor-alerts` filtra por `configItemId` e `unmatched`.
  - *Fora do escopo*: o incidente maior (S2) usa estes alertas, mas a tela e
    a lógica de incidente maior pertencem a S2; aqui não há elevação automática
    de prioridade quando um alerta correlacionado é mais grave que o primeiro.
- **Plantão**: Configurações > Plantão cria a escala (time, fuso, rodízio,
  início e hora da virada; opcionalmente um calendário de expediente, e aí a
  escala só vale **fora** dele), as camadas (1 = primeira chamada) e os
  participantes — arraste para mudar a ordem da vez. A linha do tempo mostra
  quem cobre cada período nas próximas duas semanas, já com as trocas. Para
  o escalonamento usar a escala, ligue "Passar para quem está de plantão" e
  "Avisar o plantão" na regra (Configurações > Escalonamento); sem ninguém de
  plantão o chamado continua indo para o líder, como antes.
- **Chamados recorrentes**: Configurações > Recorrentes cadastra a rotina
  (agenda + valores do chamado). O worker (`servicedesk-recurring`, a cada 5
  min) abre o chamado com ator de sistema, grava a ocorrência e recalcula o
  próximo disparo no fuso da regra; a tela pré-visualiza as próximas cinco
  ocorrências com a mesma lib que o worker usa. "Gerar agora" serve para
  testar a configuração sem esperar o horário. A aba "Rotinas" do item de
  configuração mostra as rotinas que incidem sobre ele.
- **Contratos e horas**: Configurações > Contratos cadastra o contrato do
  cliente (vigência, ciclo, franquia em minutos, valor da hora, hora de
  excedente, arredondamento, mínimo por chamado, tipos cobertos e a política
  de SLA que define o calendário). Um cliente não pode ter dois contratos
  **ativos** com vigência sobreposta (`SD_CONTRACT_OVERLAP`). A **tabela de
  valores** (`SdContractRate`) sobrepõe o valor da hora por tipo ×
  prioridade × janela (`BUSINESS_HOURS`, `AFTER_HOURS`, `WEEKEND`,
  `HOLIDAY`), com multiplicador; a primeira regra que casa vence (`position`,
  curinga com `null`).

  Ao abrir o chamado — e ao trocar o cliente — o motor carimba
  `SdTicket.contractId` com o contrato vigente que cobre o tipo
  (`resolveSdTicketContractId`, nunca interrompe a abertura). Na aba
  **"Horas"** o agente usa o cronômetro (`start`/`resume` abrem um trecho,
  `pause`/`stop` fecham; **um cronômetro aberto por usuário** em todo o
  workspace) ou lança manualmente. Ao fechar o trecho, o servidor arredonda
  **para cima** no múltiplo de `roundingMinutes`, aplica `minimumMinutes` no
  primeiro apontamento do dia naquele chamado, resolve a janela pelo
  calendário de expediente e calcula o valor. Chamado sem contrato registra
  o tempo sem valor. O agente edita e apaga o próprio apontamento enquanto o
  período está aberto; o admin mexe em qualquer um; período fechado congela
  tudo (`SD_CONTRACT_PERIOD_CLOSED`).

  O **período** (`SdContractPeriod`) é o ciclo de faturamento, ancorado no
  calendário (mensal no dia 1, trimestral em jan/abr/jul/out, anual em 1º de
  janeiro) e único por `(contractId, periodStart)`. A fila
  `servicedesk-billing` (00:20, diária) abre o período do ciclo corrente de
  cada contrato ativo e fecha os anteriores já vencidos; o admin também
  fecha à mão pela tela. No fechamento, a franquia (`includedMinutes` + o
  saldo acumulado quando `carryOver`) cobre os apontamentos faturáveis em
  ordem cronológica e só o excedente é cobrado, pela hora de excedente
  (`overtimeRate`, ou a hora da regra específica quando ela casou). O que
  sobra da franquia acumula para o período seguinte apenas com `carryOver`.
  Os cálculos ficam na lib pura `src/lib/servicedesk/billing.ts`.

- **Relatórios de SLA**: Configurações > Relatórios agenda o relatório do
  cliente (recorte por clientes, departamento e tipos — vazio = todos —,
  período apurado, formatos PDF/CSV, dia 1–28, hora e **fuso do relatório**,
  destinatários e a opção de somar os responsáveis das contas). A fila
  `servicedesk-reports` roda de hora em hora (:10): enfileira um
  `generate-report` por agendamento vencido com o período já carimbado e
  recalcula o próximo envio; a geração apura o período (volume, % de SLA de
  primeira resposta e de resolução, violações listadas, MTTR e tempo médio de
  resposta em **horário útil** do calendário do chamado, CSAT e as quebras
  por departamento, cliente e prioridade), grava PDF/CSV no bucket privado
  `servicedesk` (`<ws>/reports/<runId>.<ext>`) e manda o e-mail com o resumo
  no corpo e os arquivos anexos (acima de 8 MB vai só o link do histórico;
  `MAIL_DRY_RUN` registra sem enviar). A trava é `(reportId, periodStart)`:
  reprocessar o job **não** reenvia. "Gerar agora" apura na hora — com
  agendamento ou pontual, inclusive sem destinatário (os arquivos ficam no
  histórico) — e avisa quem pediu pelo evento `report.ready`. Como a API do
  MinIO não é pública, o download sai pela rota autenticada
  `reports/runs/[runId]/download?format=PDF|CSV`, que confere `sd-reports`
  a cada pedido. Hoje o cadastro de cliente não tem coluna de responsável,
  então "responsáveis das contas" = o e-mail do cliente + o de quem mantém
  o cadastro.
- **Integrações (Slack, GitHub e GitLab)**: desde a ADR 0024 as conexões são
  **do workspace** — conectar, testar, trocar token e desconectar ficam em
  **Ajustes > Integrações** (`/[slug]/settings/integrations`, só
  OWNER/ADMIN) e valem para todos os módulos. A aba Configurações >
  Integrações do ServiceDesk mostra o estado da conexão, aponta para Ajustes
  e guarda só o que é do módulo.

  **Slack** — o app do Slack é da instalação (`SLACK_CLIENT_ID`,
  `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`); sem as três o card do Slack
  em Ajustes aparece **indisponível com o motivo** e nada é enviado nem
  recebido. Com elas, o OWNER/ADMIN conecta o Slack por **OAuth** ("Conectar
  o Slack" → autorização → volta para Ajustes > Integrações): o token do bot
  é cifrado com `CONNECTION_SECRETS` e **nunca** volta por API, log ou tela.
  No painel do app, a URL `/api/servicedesk/integrations/slack` vai em *Event
  Subscriptions* e em *Interactivity & Shortcuts*; o callback OAuth continua
  `/api/servicedesk/integrations/oauth/slack` (caminho histórico, já
  cadastrado nos apps). Escopos de bot: `chat:write`, `chat:write.public`,
  `channels:read`, `groups:read`, `channels:history`, `groups:history`,
  `commands`, `users:read`, `users:read.email`, `channels:manage`,
  `groups:write` (os dois últimos, do swarming) — e o bot precisa ser
  convidado nos canais. Quem já tinha conectado o Slack antes do swarming
  precisa reconectar para o bot ganhar os escopos novos; sem eles o canal
  temporário falha com o motivo registrado no swarming, e o resto funciona.

  Quais eventos vão para o Slack é **regra do workspace** (Ajustes >
  Integrações > Notificações no Slack): "quando <evento> → enviar para
  <#canal>", por módulo. Para o ServiceDesk o catálogo oferece os eventos de
  chamado do catálogo de notificações (com prefixo `servicedesk.`) e o
  derivado **chamado urgente** (`servicedesk.ticket.urgent`: chamado novo com
  a prioridade de nível mais alto do workspace). Uma regra do ServiceDesk
  pode mirar "o canal do time"; no ServiceDesk, o **canal por time**
  (Configurações > Integrações) **substitui** o canal da regra nos chamados
  daquele time. A entrega passa pelo job `deliver-event`: o `notifySdEvent`
  só enfileira, então uma indisponibilidade do Slack não atrasa o chamado nem
  o SLA; cada entrega carimba o "último evento" da conexão e um erro do Slack
  carimba `status: ERROR` com o motivo.

  O **atalho de mensagem** e o **slash command** abrem chamado a partir da
  mensagem (tipo e time configuráveis no ServiceDesk), respondem na thread
  com o código e o link e gravam o vínculo `SLACK_THREAD`; com o
  espelhamento ligado, **resposta na thread vira mensagem pública** no
  histórico — o autor é casado com a conta do Steel pelo e-mail do Slack e,
  sem conta, fica registrado como autor externo.

  **GitHub e GitLab** — mesmo conjunto de recursos. Em Ajustes, o
  OWNER/ADMIN conecta o repositório (`owner/repo` ou URL; PAT fine-grained
  com *Issues* e *Pull requests: read & write*) ou o projeto do GitLab
  (gitlab.com ou instância própria — só HTTPS e host público —, `grupo/
  projeto` ou URL, token pessoal, de projeto ou de grupo com escopo `api`),
  mais o segredo do webhook; o acesso é validado na API antes de guardar.
  No ServiceDesk ficam os dois interruptores por provedor: **sugerir fase ao
  fechar** e **abrir issue a partir do chamado**. Na tela de um chamado de
  **problema ou mudança**, o agente escolhe o provedor (quando há os dois),
  vincula um item que já existe (`#42`, `owner/repo#42`, `!42` para merge
  request, `grupo/projeto!42` ou a URL; tipo e estado vêm da API) ou abre
  uma issue a partir do chamado. As chaves dos vínculos são
  `owner/repo#n` (GitHub, issue e PR compartilham número) e
  `grupo/projeto#n` / `grupo/projeto!n` (GitLab: issue e MR têm numeração
  própria).

  Webhooks: `/api/integrations/github/webhook` (o antigo
  `/api/servicedesk/integrations/github` continua aceito) e
  `/api/integrations/gitlab/webhook`. Espelham o estado em `externalState`,
  registram o evento na rastreabilidade e publicam uma mensagem no chamado;
  fechar ou mesclar **sugere** avançar a fase — quem move a fase é o
  agente. O job `sync-github-state` (de hora em hora, :40) reconcilia os
  vínculos do GitHub **e do GitLab** de chamados abertos.

  **Segurança das entradas**: rotas públicas (em `PUBLIC_ROUTES`) protegidas
  pela assinatura, conferida antes de qualquer gravação — Slack:
  `X-Slack-Signature` + `X-Slack-Request-Timestamp` (HMAC, janela de 5
  min); GitHub: `X-Hub-Signature-256` (HMAC sobre o corpo bruto); GitLab:
  `X-Gitlab-Token` (comparação em tempo constante). O repositório/projeto do
  payload só acha as conexões candidatas; vale a primeira cujo segredo
  verifica (mais de um workspace pode conectar o mesmo repositório).
  Idempotência por `event_id`/`trigger_id`, `X-GitHub-Delivery` e
  `X-Gitlab-Event-UUID`, com trava de 2 h no Redis. Desconectar apaga o
  token e o webhook deixa de ser aceito na hora; os vínculos já registrados
  ficam no histórico dos chamados.

- **Portal**: `/[slug]/servicedesk/portal`. Solicitante é todo membro com
  acesso ao módulo e sem departamento; o menu dele só mostra portal e base de
  conhecimento.
- **Modo TV**: `/[slug]/servicedesk/dashboards/[id]/tv` (tela cheia, atualiza
  sozinho; `?rotate=id1,id2&interval=60` alterna painéis).
