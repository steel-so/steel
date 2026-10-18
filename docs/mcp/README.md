# Steel MCP — contrato

Servidor MCP remoto do Steel, dentro do app (ADR 0032), autenticado por OAuth
do próprio Steel (ADR 0033). Este arquivo é o contrato entre as fatias da
onda MCP; mudou o contrato, mude aqui primeiro.

## Visão geral

```
Cliente de IA ──(1) OAuth: login + consentimento──▶ Better Auth (oauth-provider)
      │                                                   │ IntegrationGrant
      └──(2) POST /api/mcp + Bearer ──▶ resolveMcpGrant ──┘
                                         │
                                         ▼
                         registry.ts (módulo × RBAC × escopo)
                                         │ parse → execute
                                         ▼
                               services → repositories
```

## Rotas

| Rota | Dono | O que faz |
| --- | --- | --- |
| `/api/auth/oauth2/*` | mcp-auth | authorize, token, register (registro dinâmico), revoke — do `@better-auth/oauth-provider` |
| `/.well-known/oauth-authorization-server` | mcp-auth | metadados do servidor de autorização |
| `/.well-known/oauth-protected-resource` | mcp-auth | metadados do recurso (`resource` = `<app>/api/mcp`) |
| `/oauth/consent` | mcp-auth | tela de consentimento em pt-BR: workspace, módulos, escopo |
| `/api/oauth/consent` (POST) | mcp-auth | resposta da tela: grava a `IntegrationGrant` e pede o código ao provedor |
| `/api/users/me/integration-grants` (GET, DELETE `/{id}`) | mcp-auth | Apps conectados do usuário |
| `/api/workspaces/{id}/integration-grants` (GET; DELETE `/{grantId}`, `/members/{userId}`, `/clients/{clientId}`) | mcp-workspace-apps | Apps conectados de todos os membros (OWNER/ADMIN): listar, revogar uma, todas de um membro, todas de um app |
| `/api/mcp` (POST; GET/DELETE respondem 405) | mcp-server | servidor MCP, Streamable HTTP sem estado |

`proxy.ts`: `/api/mcp`, `/.well-known/oauth-*` e `/api/auth/oauth2/*` são
públicas no proxy (a autenticação é por bearer, não por cookie). `/oauth/consent`
exige sessão: sem sessão, vai para `/sign-in` e volta.

## Escopos

| Escopo | Dá acesso a |
| --- | --- |
| `mcp:read` | ferramentas `READ`, resources e prompts |
| `mcp:write` | também `CREATE`, `UPDATE` e `ACTION`, se o admin ligou "Permitir escrita via MCP" |

`DELETE` nunca é exposto.

### Interruptor "Permitir escrita via MCP" (fatia mcp-ai-settings)

- Coluna `WorkspaceAiSettings.mcpWriteEnabled` (`mcp_write_enabled`,
  padrão `false`), alterada só por OWNER/ADMIN em
  `PATCH /api/workspaces/{id}/ai-settings` (`{ mcpWriteEnabled }`) e na tela
  Ajustes › Steel IA › Recursos do Steel AI. A troca entra na auditoria
  (`workspace_ai_settings` / `update`, `meta.changedSwitches`).
- `resolveToolAccess` devolve `AiToolAccess.mcpWriteEnabled` (campo opcional,
  sempre preenchido por ele; ausente = `false`). `isToolAllowed` **não** o lê:
  o assistente do app não muda. Quem decide é o servidor MCP — escrita só com
  `mcp:write` no grant **e** `mcpWriteEnabled` (onda 2, mcp-governance).
- Independe do modo agente (`agentModeEnabled`) e do Autopilot, que valem para
  o chat do app; com `aiEnabled` desligado a tela trava o interruptor e o
  servidor MCP não deve oferecer ferramenta nenhuma.

## Tipo compartilhado

`src/lib/mcp/grant.ts`: `McpGrant`, `McpScope`, `MCP_SCOPES` e
`resolveMcpGrant(request)`. O `mcp-auth` implementa; o `mcp-server` só
consome (nos testes, faz mock do módulo).

`IntegrationGrant` (Prisma, dono `mcp-auth`): `id`, `userId`, `workspaceId`,
`clientId`, `scopes String[]`, `modules ModuleKind[]`, `lastUsedAt`,
`revokedAt`, `createdAt`, `updatedAt`. Única por (`userId`, `clientId`,
`workspaceId`) enquanto não revogada.

Como a concessão chega ao token (decidido na fatia mcp-auth):

- O `referenceId` do consentimento, do código e dos tokens do plugin é o
  `IntegrationGrant.id`. A tela chama `POST /api/oauth/consent`, que grava a
  concessão e repassa o aceite ao plugin dentro de um `AsyncLocalStorage`
  com o id (`src/lib/mcp/consent-reference.ts`).
- Fora desse caminho o `referenceId` é um valor que nenhum consentimento
  tem, então **toda** autorização passa pela tela (não há aprovação
  automática) e nenhum token nasce sem concessão.
- Tokens opacos (`disableJwtPlugin`), com prefixo `stl_at_` / `stl_rt_`,
  guardados como SHA-256. Access token vale 1 h; refresh 30 dias, só com
  `offline_access`.
- `resolveMcpGrant`: token → linha `oauth_access_tokens` (hash) → concessão
  ativa do mesmo usuário e cliente → `assertMember` → módulos ainda
  habilitados no workspace (a interseção com `grant.modules`) → escopos
  que o token **e** a concessão têm. Qualquer falha é `UNAUTHORIZED`; erro de
  banco propaga.
- "Módulos a que o usuário tem acesso" = os habilitados no workspace: o
  Steel não tem gate de módulo por usuário; o RBAC de cada ferramenta vale
  na chamada.
- Revogar apaga os access tokens, marca os refresh tokens como revogados e
  remove o consentimento, numa transação.
- Aviso LGPD da tela com versão `mcp-consent-v1`
  (`src/lib/mcp/consent-notice.ts`), registrada no `auditAuth`
  `auth.oauth_consent.granted` junto com escopos e módulos.

`AiToolContext.source` ganha `'mcp'` e o contexto ganha `oauthClientId?`
(dono `mcp-server`).

## Regras do servidor

- `tools/list`: módulo + RBAC do registry (`hasToolAccess`) com o
  `AiToolAccess` do usuário, restrito a `grant.modules` e aos tipos de
  `mcpAllowedKinds(grant, access)` — só `READ` sem `mcp:write` ou sem o
  interruptor do admin; `DELETE` nunca.
- `tools/call`: workspace e usuário vêm do grant, nunca dos argumentos.
  `AppError` vira resultado com `isError: true` e mensagem em pt-BR.
- Anotações: `readOnlyHint` nas de leitura, `destructiveHint` onde couber,
  `title` = `label` da ferramenta.
- Rate limit `mcp:<userId>` e `mcp-client:<clientId>`; `withAxiom` na rota.

## Metadados das ferramentas (fatia mcp-tool-quality)

`SteelAiTool` (`src/lib/ai/tools/types.ts`) tem dois campos opcionais para
clientes externos:

- `annotations?: { idempotentHint?, destructiveHint?, openWorldHint? }` — as
  dicas do MCP (`ToolAnnotations`). O adaptador monta as anotações assim:
  `title` = `label`; `readOnlyHint` = `kind === 'READ'`; `destructiveHint` =
  o declarado (leitura: `false`); `idempotentHint` e `openWorldHint` = o
  declarado ou `false`. **Os padrões do Steel são `false`, não os do MCP**
  (que assume `destructiveHint` e `openWorldHint` verdadeiros quando faltam),
  por isso o adaptador sempre envia os quatro valores.
- `customerFacing?: boolean` — a ferramenta entrega algo a um cliente final
  ou a alguém de fora da equipe (mensagem de WhatsApp, e-mail, resposta
  pública no chamado, link de aprovação, aviso com texto escrito por quem
  chamou). Na onda 2, escrita externa com `customerFacing` sempre passa por
  confirmação humana. Hoje: `zap_message_send_text`, `sd_reply_to_requester`,
  `sd_request_approval`, `sd_move_ticket_phase` (o solicitante é avisado da
  fase e, ao resolver, recebe a solução) e `sd_cancel_ticket`.

Critério de `destructiveHint`: verdadeiro quando apaga, sobrescreve texto ou
campo (o valor anterior se perde) ou faz algo sem volta (`DELETE`, cancelar
chamado, fechar lead como ganho); falso para o que só acrescenta (criar,
vincular, nota) e para mudança de estado que outra ferramenta desfaz
(atribuir, mover etapa, encerrar ou reabrir conversa).

`validateToolRegistry` recusa (e o app não sobe): leitura destrutiva ou
`customerFacing`; escrita sem `destructiveHint` declarado; `DELETE` não
destrutiva; `CREATE` destrutiva; `customerFacing` sem `openWorldHint: true`;
`label` vazio ou com mais de 40 caracteres.

As descrições são lidas por clientes externos: neutras (sem "o chat", "o
assistente", aba ou atalho da interface), em pt-BR, precisas sobre campos e
efeitos colaterais (quem é avisado, o que não tem volta). Os `href`
devolvidos pelas ferramentas são caminhos relativos do app; o adaptador deve
torná-los absolutos (`<origem>/<caminho>`).
- O grant atualiza `lastUsedAt` no máximo uma vez por minuto.

### Detalhes do `mcp-server` (onda 1)

- **Transporte:** `WebStandardStreamableHTTPServerTransport` do
  `@modelcontextprotocol/sdk` (versão fixa), sem sessão e com respostas JSON;
  servidor e transporte novos a cada POST.
- **Ordem na rota:** `resolveMcpGrant` → rate limit `mcp:<userId>` (120/min)
  e `mcp-client:<clientId>` (600/min) → `resolveToolAccess` → handler. Falha
  no grant, ou acesso que responde 401/403/404 (membro removido), devolve
  `401` com `WWW-Authenticate: Bearer resource_metadata="<BETTER_AUTH_URL>/.well-known/oauth-protected-resource"`
  (mais `error="invalid_token"` quando veio token).
- **Escrita:** `mcpAllowedKinds(grant, access)` em `src/lib/mcp/tools.ts`
  (onda 1: só `READ`; a onda 2 alargou só essa função — ver "Escrita via MCP"
  abaixo).
- **Steel IA desligada** (`aiEnabled = false` em Ajustes › Steel IA): nenhuma
  ferramenta aparece. Resources e prompts continuam.
- **Ferramenta fora do grant** responde igual a uma inexistente
  (`-32602 Ferramenta desconhecida`).
- **Resultado:** `content` = resumo + JSON; `structuredContent` =
  `{ summary, data, truncated?, note? }`, com o teto de `TOOL_OUTPUT_MAX_BYTES`.
- **Anotações:** `readOnlyHint` pelo `kind`; `destructiveHint`,
  `idempotentHint` e `openWorldHint` vêm de `tool.annotations` quando a
  ferramenta declara, senão do padrão (`DELETE`, `READ`, `false`).
- **Resources** (Markdown, 50 por página, cursor opaco):
  `steel://servicedesk/kb/{id}` (artigo `PUBLISHED` e não arquivado; só com
  `SERVICE_DESK` no grant e habilitado) e `steel://wiki/pages/{id}` (página
  não arquivada; Wiki ligada). Lidos pelos services, com as mesmas regras do
  app. Não encontrado → `-32002`.
- **Prompts:** `servicedesk_daily_summary` ("Resumo do dia do ServiceDesk"),
  `crm_weekly_pipeline` ("Pipeline da semana") e
  `whatsapp_unanswered_conversations` ("Conversas sem resposta"), um por
  módulo concedido e habilitado.

### Apps conectados do workspace (fatia mcp-workspace-apps)

- **Quem:** só OWNER/ADMIN (`assertPrivileged`); membro comum e VIEWER levam
  `403`. Concessão de outro workspace, já revogada ou inexistente é
  `INTEGRATION_GRANT_NOT_FOUND`.
- **Lista:** `{ grants, clients }`. `grants` = concessões ativas com o
  usuário (`id`, `name`, `email`, `image`), app, escopos, módulos,
  `lastUsedAt`, `createdAt` e `usage`; `clients` = um resumo por app com
  concessão ativa (`members`, `canWrite`, último uso e `usage`).
- **Revogação em lote** (`/members/{userId}`, `/clients/{clientId}`): uma
  transação, só as ativas; responde `{ revoked }` (0 quando não havia
  nenhuma, sem erro). Mesmo efeito do `revoke` do usuário: apaga access
  tokens, revoga refresh tokens e remove o consentimento.
- **Auditoria:** `auditMutation` com `entity: 'integration_grant'`,
  `action: 'revoke'`, `meta.target` = `grant` | `member` | `client`
  (`grantIds` e `revoked` no lote; `clientId` e `holderId` na unitária).
- **Uso por app** (`usage = { last7Days, last30Days }`): conta cada
  `tools/call` de ferramenta visível ao grant, inclusive pelo
  `steel_call_tool` (conta a ferramenta-alvo, nunca a meta-ferramenta; não
  conta `initialize`, `tools/list`, `steel_find_tools`, resources nem
  prompts). É separado do ranking por ferramenta da descoberta
  (`mcp:tool-usage:*`, `src/lib/mcp/tool-usage.ts`). Contador no Redis, sem tabela: um
  hash por workspace por dia, `mcp:usage:<workspaceId>:<YYYY-MM-DD>` (dia de
  São Paulo), campos `c:<clientId>` e `g:<grantId>`, TTL de 32 dias
  (`src/cache/mcp-usage.cache.ts`). A rota `/api/mcp` grava pelo gancho
  `McpServerDeps.onToolCall` do adaptador, sem esperar a resposta; falha do
  Redis perde a contagem, nunca a chamada. O total por app inclui
  concessões já revogadas; o por concessão some com ela. Perda do Redis zera
  a janela — aceitável para um indicador de uso, não serve para cobrança.
- **Tela:** Ajustes do workspace › **Apps conectados**
  (`/<slug>/settings/connected-apps`), com as seções "Por app" e "Por
  membro".

## Escrita via MCP (fatia mcp-governance, onda 2)

- **Quando aparece:** `mcpAllowedKinds(grant, access)` devolve `READ`,
  `CREATE`, `UPDATE` e `ACTION` só com `mcp:write` no grant **e**
  `AiToolAccess.mcpWriteEnabled`. `DELETE` nunca. Não depende de
  `agentModeEnabled` nem de `autopilotEnabled` (que valem para o chat do
  app). O filtro de módulo/RBAC é `hasToolAccess` do registry.
- **Sem `customerFacing`:** executa na hora, como o Autopilot (ADR 0021):
  `executeMcpWrite` (`ai-pending-action.service.ts`) cria a
  `AiPendingAction` já reivindicada (`EXECUTED`, `autoExecuted`,
  `integrationGrantId`), roda, grava `AiActionLog` com `source = MCP` e
  `oauthClientId`, e audita `ai_pending_action` / `auto_execute` com
  `meta.mode = 'MCP'`. Resultado: `structuredContent = { status:
  'executed', summary, actionId, target?, data, truncated?, note? }`.
- **Com `customerFacing`:** só propõe. `proposeMcpWrite` cria a
  `AiPendingAction` `PENDING` (dona = usuário do grant, 30 min,
  `integrationGrantId`) e audita `ai_pending_action` / `request`. Resultado:
  `{ status: 'pending_confirmation', summary, actionId, confirmUrl,
  expiresAt, preview }`, com `confirmUrl = <origem>/<slug>/inbox?view=ai&action=<id>`.
  A descrição da ferramenta em `tools/list` ganha um parágrafo avisando
  disso.
- **Elicitation:** não é usada. Ela exige um pedido servidor→cliente no meio
  da chamada, e o transporte sem estado (servidor novo por POST, resposta
  JSON) não tem como receber a resposta. O link de confirmação é o único
  caminho, e funciona em qualquer cliente.
- **Confirmação:** a mesma rota do chat
  (`POST /api/workspaces/{id}/ai/actions/{actionId}/confirm`), pela
  Caixa de entrada › Pendências da IA. Para ação com `integrationGrantId` o
  portão é o do MCP, não o do modo agente: `mcpWriteEnabled` ligado
  (senão `403 MCP_WRITE_DISABLED`), grant ativo do mesmo usuário com
  `mcp:write` e o módulo, ferramenta ainda permitida e não `DELETE` (senão
  `403 AI_TOOL_NOT_ALLOWED`). Executa com `source: 'mcp'` e o
  `oauthClientId`, então o `AiActionLog` sai como MCP.
- **Inbox:** `InboxAiPendingItemDTO.client` (`{ id, name }`) marca o que veio
  de um app conectado; `path` é `/inbox?view=ai`. O cartão mostra "App
  conectado · <nome>" e destaca a ação de `?action=<id>`; ação que não está
  mais pendente mostra um aviso.
- **Revogar** (`IntegrationGrantRepository.revoke`, qualquer caminho) cancela,
  na mesma transação, as `AiPendingAction` `PENDING` daquele grant.
- **`idempotencyKey`:** argumento opcional de toda escrita (1–200
  caracteres; o adaptador o acrescenta ao `inputSchema` e o tira dos
  argumentos antes do `parse`). Redis `mcp:idem:<grantId>:<tool>:<sha256(chave)>`:
  `SET NX` de um marcador `pending` (2 min), resultado final guardado por
  24 h junto com o hash canônico dos argumentos (`src/cache/mcp-idempotency.cache.ts`).
  Mesma chave e argumentos → devolve o primeiro resultado; em execução →
  `MCP_IDEMPOTENCY_IN_PROGRESS` (409); argumentos diferentes →
  `MCP_IDEMPOTENCY_KEY_REUSED` (422); falha libera a chave. Redis fora do ar
  não bloqueia a escrita (roda sem dedupe e registra aviso).
- **Links absolutos:** todo `href` (string que começa com uma única `/`) nos
  resultados, de leitura e de escrita, vira `<origem do BETTER_AUTH_URL><caminho>`
  (`absolutizeHrefs`).
- **Modelo:** `AiActionSource.MCP`, `AiActionLog.oauthClientId` e
  `AiPendingAction.integrationGrantId` (FK com cascade), migração
  `mcp_action_source`. `aiActionSource(ctx)` no registry mapeia
  `assistant`/`agent`/`mcp`.

## Observabilidade e descoberta (fatia mcp-observability)

### Log (Axiom)

Uma linha por evento, montada em `src/lib/mcp/telemetry.ts`. **Nunca** vão
argumentos, resultado de ferramenta nem texto do usuário (LGPD).

| `message` | Nível | Campos (`fields.*`) |
| --- | --- | --- |
| `mcp.tool_call` | `info` (`error` se `failed`) | `toolName`, `kind`, `module` (`PLATFORM` sem módulo), `workspaceId`, `userId`, `clientId`, `outcome` (`ok` · `error` = `AppError` devolvido como `isError` · `failed` = a ferramenta lançou), `errorCode`, `durationMs`, `source = mcp`; `detail` = `{ grantId, clientName, via?, writeStatus? }` (`via = steel_call_tool`; `writeStatus` nas escritas: `executed` · `pending_confirmation` · `replayed`, todas com `outcome = ok`) |
| `mcp.tools_list` | `info` | `count` (listadas), `clientId`, `workspaceId`, `userId`; `detail` = `{ hidden }` |
| `mcp.rejected` | `warn` | `reason` (`invalid_token`, `stale_grant`, `rate_limited_user`, `rate_limited_client`, `access_failed`), `errorCode`, `clientId`/`userId`/`workspaceId` quando há grant |
| `mcp.handler_failed` | `error` | `toolName` (só em `tools/call`), `clientId`, `workspaceId`, `message`; `detail` = `{ method }` |

`toolName` e `clientId` entraram em `ALLOWED_LOG_FIELD_KEYS`
(`lib/axiom/log-fields.ts`): viram colunas próprias para o painel agrupar
sem `parse_json`. Painel: `docs/mcp/axiom-dashboard.json` (chamadas por
desfecho, erros por ferramenta/código, p50/p95 por ferramenta, clientes com
mais chamadas, recusas, falhas, tamanho do `tools/list`).

### Erros inesperados (Sentry)

- Exceção dentro do `execute` de uma ferramenta: o registry a transforma em
  `INTERNAL_SERVER_ERROR` (o cliente vê `isError`); antes disso o adaptador
  manda a causa ao Sentry e o log sai com `outcome = failed`.
- Exceção em qualquer handler MCP (`tools/list`, resources, prompts…) que
  não seja `McpError`: vai ao Sentry, sai `mcp.handler_failed` no Axiom e o
  cliente recebe `-32603` com mensagem genérica em pt-BR (nada interno
  vaza). `McpError` (protocolo, ex. `-32602`, `-32002`) passa direto.
- Tags: `component = mcp`, `mcp.method`, `mcp.client`, `mcp.tool` (só em
  `tools/call`). Sem argumentos, sem request, sem resultado. Sem DSN, nada
  é importado (mesmo contrato do `instrumentation.ts`).

### Descoberta de ferramentas (`src/lib/mcp/discovery.ts`)

Clientes MCP põem todas as ferramentas listadas no contexto do modelo; com
o registry inteiro (admin com os três módulos: ~44 de leitura hoje, mais as
escritas na onda 2) a lista fica cara e o modelo escolhe pior.

- **Até 40 ferramentas expostas** (`MCP_TOOLS_LIST_THRESHOLD`): lista tudo,
  sem meta-ferramentas.
- **Acima disso** o `tools/list` leva:
  1. as de plataforma (`module: null`) e **todas as de escrita** — o
     cliente decide o que confirmar pelas anotações de cada escrita, então
     escrita nunca fica atrás de uma ferramenta genérica;
  2. até 20 de leitura de módulo (`MCP_COMPACT_READ_TOOLS`), das
     categorias mais usadas. Categoria = `módulo:recurso RBAC`
     (`permission.resource`; sem recurso = `geral`). Ordem: chamadas MCP do
     workspace no mês atual + anterior, depois uma ordem padrão (chamados,
     oportunidades, leads, conversas, base de conhecimento…), depois a do
     registry. Cada módulo exposto recebe primeiro uma cota justa
     (`20 / nº de módulos`) da sua categoria do topo; o resto segue o
     ranking, e uma categoria pode entrar em parte (as ferramentas mais
     chamadas dela primeiro);
  3. `steel_find_tools` — `{ module?, query? }`, mesma busca do assistente
     (`findTools` de `selection.ts`) sobre **todas** as expostas; devolve
     até 10 com `name`, `title`, `kind`, `module`, `description`,
     `inputSchema` (compactado) e `listed`;
  4. `steel_call_tool` — `{ name, arguments? }`, executa uma ferramenta de
     **leitura** exposta (clientes só deixam o modelo chamar o que foi
     listado). Escrita é recusada com `isError` (`AI_TOOL_NOT_ALLOWED`):
     ela já está na lista, com as próprias anotações. Nome fora do grant:
     `-32602`, como no `tools/call`.
- Esconder é decisão de **listagem**, não de acesso: `tools/call` com o
  nome real de uma ferramenta escondida funciona. As duas meta-ferramentas
  são `readOnlyHint: true`, não destrutivas, idempotentes e fechadas
  (`openWorldHint: false`), e só respondem enquanto algo está escondido.
- Uso: hash Redis `mcp:tool-usage:<workspaceId>:<YYYY-MM>` (fuso de São
  Paulo), campo = nome da ferramenta, `HINCRBY` a cada `tools/call`, TTL de
  62 dias (`src/lib/mcp/tool-usage.ts`). É dica de produto por workspace,
  nunca entrada de autorização; sem Redis o ranking cai na ordem padrão.
  O Redis só é lido quando a lista passa do limite.
- Sem sessão (Streamable HTTP sem estado) não há
  `notifications/tools/list_changed`: a lista é recalculada a cada
  `tools/list`.
- **Onda 2 (mcp-governance):** as escritas liberadas por
  `mcpAllowedKinds` entram sempre no grupo 1; `steel_call_tool` continua só
  de leitura.

Incidente com um cliente: `docs/runbooks/mcp-incident.md`.

## Fatias

| Fatia | Onda | Entrega |
| --- | --- | --- |
| mcp-auth | 1 | provedor OAuth, consentimento, `IntegrationGrant`, `resolveMcpGrant`, Apps conectados do usuário |
| mcp-server | 1 | `/api/mcp`, adaptador do registry (leitura), resources, prompts |
| mcp-docs | 1b | `/dev/mcp` (guia com a lista de ferramentas gerada do registry no build), manual "Conectar o Steel ao Claude, ChatGPT ou Cursor", runbook `docs/runbooks/mcp-edge-proxy.md`, MCP em todos os planos (`docs/plans-review.md`) |
| mcp-observability | 2 | log por chamada no Axiom + painel, Sentry no adaptador, descoberta (`steel_find_tools`/`steel_call_tool`) acima de 40 ferramentas, runbook de incidente |
| mcp-governance | 2 | escrita via `mcp:write`, interruptor do admin, changelog; tira o aviso "Escrita em liberação" de `content/dev/mcp.mdx` |
| mcp-workspace-apps | 2 | Apps conectados do workspace (OWNER/ADMIN): lista, revogação unitária, por membro e por app, contagem de chamadas por app em 7/30 dias |

| mcp-governance | 2 | escrita via `mcp:write` + interruptor do admin, confirmação no Steel das ações com cliente final, `idempotencyKey`, `AiActionLog` com origem MCP, links absolutos; tira o aviso "Escrita em liberação" de `content/dev/mcp.mdx` |
| mcp-workspace-apps | 2 | Apps conectados do workspace (OWNER/ADMIN), uso por cliente |
| mcp-launch | 3 | changelog do produto e da API, [envio aos diretórios](directory-submission.md) do Claude e do ChatGPT, `pnpm mcp:smoke` (cliente MCP de smoke, com `--oauth`) |
