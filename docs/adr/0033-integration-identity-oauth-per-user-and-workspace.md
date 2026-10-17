# 0033 — Identidade de integrações: OAuth por usuário e workspace

- **Status:** Aceita
- **Data:** 2026-10-17
- **Decisores:** product owner + time de engenharia

## Contexto

Hoje a API só aceita o cookie de sessão do navegador. A única chave de API
é a `crm_live_` (`CrmIntegrationApiKey`): de workspace, sem usuário, e só
para leads. O servidor MCP (ADR 0032) e o futuro Steel CLI precisam agir
**como um usuário**, para o RBAC (ADR 0013) valer igual ao app, e limitados
a um workspace e a escopos que o usuário escolheu.

O Better Auth 1.6 traz o plugin `oidc-provider` (e o `mcp`, construído sobre
ele), ambos marcados como obsoletos em favor do pacote
`@better-auth/oauth-provider`.

## Decisão

**Integrações se autenticam com OAuth 2.1 do próprio Steel, emitido pelo
`@better-auth/oauth-provider`, e cada concessão fica presa a um usuário, um
workspace, um conjunto de escopos e de módulos.**

Detalhes para aplicar:

- Provedor: `@better-auth/oauth-provider` na linha 1.6 compatível com o
  `better-auth` instalado (atualizar o patch do `better-auth` se o pacote
  exigir). Não usar os plugins obsoletos `oidc-provider` e `mcp`.
- Fluxo: authorization code + PKCE, registro dinâmico de cliente (clientes
  MCP se registram sozinhos), refresh token e revogação. Metadados em
  `/.well-known/oauth-authorization-server` e
  `/.well-known/oauth-protected-resource`.
- Consentimento em pt-BR, no Steel: o usuário escolhe o **workspace**, os
  **módulos** (só os que estão habilitados e a que ele tem acesso) e o
  **escopo** (`mcp:read` ou `mcp:read` + `mcp:write`).
- A concessão é guardada em `IntegrationGrant` (usuário, workspace, cliente
  OAuth, escopos, módulos, último uso, revogação). O token resolve para essa
  concessão a cada chamada; membro removido ou concessão revogada respondem
  401 na chamada seguinte.
- Ajustes › Segurança › **Apps conectados** lista e revoga as concessões do
  usuário; o admin do workspace vê e revoga as de todos os membros.
- O CLI usará o mesmo provedor (device flow) e um token pessoal para CI,
  decididos no plano do CLI.

## Consequências

- O RBAC, o acesso a módulos e a auditoria funcionam igual ao app, porque a
  chamada roda com o `actorId` do usuário.
- A `CrmIntegrationApiKey` continua existindo para leads; não é migrada.
- Mais uma superfície de autenticação pública para manter e testar (e2e do
  fluxo completo e da revogação).
- Revisitar quando o pacote `@better-auth/oauth-provider` mudar de major.
