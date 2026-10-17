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
| `/api/users/me/integration-grants` (GET, DELETE `/{id}`) | mcp-auth | Apps conectados do usuário |
| `/api/workspaces/{id}/integration-grants` (GET, DELETE `/{id}`) | mcp-governance | Apps conectados de todos os membros (OWNER/ADMIN) |
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

## Tipo compartilhado

`src/lib/mcp/grant.ts`: `McpGrant`, `McpScope`, `MCP_SCOPES` e
`resolveMcpGrant(request)`. O `mcp-auth` implementa; o `mcp-server` só
consome (nos testes, faz mock do módulo).

`IntegrationGrant` (Prisma, dono `mcp-auth`): `id`, `userId`, `workspaceId`,
`clientId`, `scopes String[]`, `modules ModuleKind[]`, `lastUsedAt`,
`revokedAt`, `createdAt`, `updatedAt`. Única por (`userId`, `clientId`,
`workspaceId`) enquanto não revogada.

`AiToolContext.source` ganha `'mcp'` e o contexto ganha `oauthClientId?`
(dono `mcp-server`).

## Regras do servidor

- `tools/list`: `isToolAllowed` do registry com o `AiToolAccess` do usuário,
  restrito a `grant.modules`, só `READ` sem `mcp:write`.
- `tools/call`: workspace e usuário vêm do grant, nunca dos argumentos.
  `AppError` vira resultado com `isError: true` e mensagem em pt-BR.
- Anotações: `readOnlyHint` nas de leitura, `destructiveHint` onde couber,
  `title` = `label` da ferramenta.
- Rate limit `mcp:<userId>` e `mcp-client:<clientId>`; `withAxiom` na rota.
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
- **Escrita:** `mcpAllowedKinds(grant)` em `src/lib/mcp/tools.ts` devolve só
  `READ` na onda 1, mesmo com `mcp:write`. A onda 2 alarga **só essa função**.
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

## Fatias

| Fatia | Onda | Entrega |
| --- | --- | --- |
| mcp-auth | 1 | provedor OAuth, consentimento, `IntegrationGrant`, `resolveMcpGrant`, Apps conectados do usuário |
| mcp-server | 1 | `/api/mcp`, adaptador do registry (leitura), resources, prompts |
| mcp-governance | 2 | escrita via `mcp:write`, interruptor do admin, Apps conectados do workspace, `/dev/mcp`, manual e changelog |
