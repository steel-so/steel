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
| `/api/workspaces/{id}/integration-grants` (GET, DELETE `/{id}`) | mcp-workspace-apps | Apps conectados de todos os membros (OWNER/ADMIN) |
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

## Fatias

| Fatia | Onda | Entrega |
| --- | --- | --- |
| mcp-auth | 1 | provedor OAuth, consentimento, `IntegrationGrant`, `resolveMcpGrant`, Apps conectados do usuário |
| mcp-server | 1 | `/api/mcp`, adaptador do registry (leitura), resources, prompts |
| mcp-docs | 1b | `/dev/mcp` (guia com a lista de ferramentas gerada do registry no build), manual "Conectar o Steel ao Claude, ChatGPT ou Cursor", runbook `docs/runbooks/mcp-edge-proxy.md`, MCP em todos os planos (`docs/plans-review.md`) |
| mcp-governance | 2 | escrita via `mcp:write` + interruptor do admin, confirmação no Steel das ações com cliente final, `idempotencyKey`, `AiActionLog` com origem MCP, links absolutos; tira o aviso "Escrita em liberação" de `content/dev/mcp.mdx` |
| mcp-workspace-apps | 2 | Apps conectados do workspace (OWNER/ADMIN), uso por cliente |
