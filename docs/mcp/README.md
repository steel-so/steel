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

- `tools/list`: `isToolAllowed` do registry com o `AiToolAccess` do usuário,
  restrito a `grant.modules`, só `READ` sem `mcp:write`.
- `tools/call`: workspace e usuário vêm do grant, nunca dos argumentos.
  `AppError` vira resultado com `isError: true` e mensagem em pt-BR.
- Anotações: `readOnlyHint` nas de leitura, `destructiveHint` onde couber,
  `title` = `label` da ferramenta.
- Rate limit `mcp:<userId>` e `mcp-client:<clientId>`; `withAxiom` na rota.
- O grant atualiza `lastUsedAt` no máximo uma vez por minuto.

## Fatias

| Fatia | Onda | Entrega |
| --- | --- | --- |
| mcp-auth | 1 | provedor OAuth, consentimento, `IntegrationGrant`, `resolveMcpGrant`, Apps conectados do usuário |
| mcp-server | 1 | `/api/mcp`, adaptador do registry (leitura), resources, prompts |
| mcp-governance | 2 | escrita via `mcp:write`, interruptor do admin, Apps conectados do workspace, `/dev/mcp`, manual e changelog |
