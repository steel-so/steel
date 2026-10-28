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

## Atualização (18/10/2026)

A tela de consentimento mostrava no título o `client_name` que o próprio app
registrou. Com registro dinâmico aberto, qualquer um registra um cliente
chamado "Claude" com um `redirect_uri` seu e manda o link para a vítima
(*consent phishing*). A partir desta data:

- A identidade do app na tela é o **host do `redirect_uri`** da autorização,
  lido no servidor da query assinada pelo provedor (que já conferiu o
  `redirect_uri` com os registrados). A página confere a assinatura antes de
  renderizar: query adulterada mostra erro, não a tela.
- Uma lista curta em `src/lib/mcp/client-trust.ts` marca como **Verificado**
  os clientes conhecidos, casados pelo host e nunca pelo nome: Claude
  (`claude.ai`, `claude.com`), ChatGPT (`chatgpt.com`, `openai.com`) e Cursor
  (`cursor.com`, `cursor.sh` e o esquema `cursor://`), só em HTTPS para
  hosts web. O nome mostrado vem da lista.
- Redirect de loopback (`localhost`, `127.0.0.0/8`, `[::1]`) mostra o
  `client_name` e "um app no seu computador": o código não sai da máquina
  da pessoa.
- Todo o resto aparece como **App não verificado**, identificado pelo host,
  com o nome declarado entre aspas ("diz chamar-se …"). O aviso LGPD usa
  "app em `host`" no lugar do nome; o texto-base não mudou, então
  `MCP_CONSENT_NOTICE_VERSION` continua `mcp-consent-v1`.
- O host mostrado fica em `IntegrationGrant.redirectHost` e no evento
  `auth.oauth_consent.granted` (`redirectHost`, `clientTrust`), e **Apps
  conectados** o mostra ao lado do nome. Concessões anteriores ficam com o
  host nulo até a próxima autorização.

## Atualização (18/10/2026) — concessão sem token vivo e revogação pública

- Cada ciclo `steel mcp logout`/`login` deixava uma entrada morta em **Apps
  conectados**: o cliente revogava os tokens, mas a concessão continuava
  ativa. Agora uma concessão **sem nenhum token vivo** é revogada sozinha
  (`IntegrationGrantLifecycleService`): logo depois de `/oauth2/revoke` e de
  um refresh recusado (reuso de refresh token derruba a família), e toda
  madrugada no `data-retention` para as paradas há 1 dia. Token vivo é
  refresh token não revogado e não vencido, ou access token não vencido que
  não esteja preso a um refresh token já revogado. A regra torna qualquer
  gatilho seguro: concessão com token utilizável nunca é tocada. Evento de
  auditoria próprio, `auth.integration_grant.expired`, separado da revogação
  feita por pessoa.
- Os metadados do servidor de autorização passam a anunciar `none` em
  `revocation_endpoint_auth_methods_supported`: o plugin aceitava cliente
  público revogando só com `client_id`, mas não anunciava.

## Atualização (27/10/2026) — Better Auth 1.7

O `better-auth` e o `@better-auth/oauth-provider` subiram de 1.6.23 para
1.7.12 (correção da GHSA-965c-763c-88jm, que não tem patch na linha 1.6). A
decisão continua a mesma; mudam detalhes do provedor:

- **Recursos protegidos.** A lista `validAudiences` deixou de existir. Os três
  alvos aceitos (`<app>/api/mcp`, o emissor `<app>/api/auth` e a origem) agora
  são linhas de `oauth_resources`, semeadas na subida do app a partir de
  `src/lib/auth.ts`. Qualquer cliente pode pedir qualquer um deles
  (`enforcePerClientResources: false`), como antes: todos são do Steel, e os
  clientes registrados antes da 1.7 não têm vínculo em
  `oauth_client_resources`.
- **Registro dinâmico.** Sem `application_type`, o cliente é classificado pelo
  redirect (`infer`): loopback (`steel mcp login`, Claude Code, Cursor) vira
  `native`, o resto `web` com HTTPS obrigatório. Um registro sem
  `token_endpoint_auth_method` agora é **confidencial**
  (`client_secret_basic`, com segredo); cliente público precisa declarar
  `none`, como o Steel CLI e os clientes MCP conhecidos já fazem.
- **Fim de sessão.** Quando a sessão do navegador que deu o consentimento
  termina (sair, sessão revogada), o provedor marca como revogados os access
  tokens emitidos nela (`oauth_access_tokens.revoked`). O refresh token com
  `offline_access` sobrevive, então o cliente só renova o access token; o
  `IntegrationGrantService.resolveAccessToken` e a regra de "token vivo"
  passam a considerar essa coluna.
- **Migração** `better_auth_17_oauth_provider`: colunas novas nas tabelas do
  provedor, `oauth_resources`, `oauth_client_resources` e
  `oauth_client_assertions`; `oauth_clients.type` e `oauth_clients.public`
  viram `application_type` e `token_endpoint_auth_method = 'none'` antes de
  sair.
