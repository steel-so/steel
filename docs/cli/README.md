# Steel CLI — contrato

Contrato entre as fatias do Steel CLI: API pública v1 e tokens pessoais
(ADR 0035), webhooks de saída (ADR 0036) e o CLI/SDK em `steel-so/steel-cli`
(ADR 0034). Mudou o contrato, mude aqui primeiro. Plano aprovado:
"Plano — Steel CLI" (Claude Docs, 2026-10-17).

## Autenticação (fatia `api-tokens`)

| Rota | O que faz |
| --- | --- |
| `POST /api/v1/auth/device` | corpo opcional `{ clientName?, deviceName? }`; inicia o login do CLI: `{ deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn }` |
| `DELETE /api/v1/auth/token` | `steel logout`: revoga o token pessoal da própria chamada (`Authorization: Bearer stl_pat_...`); `204` sem corpo, `401` se o token já não vale |
| `POST /api/v1/auth/device/token` | o CLI consulta com `{ deviceCode }`: `428 AUTHORIZATION_PENDING`, `429 SLOW_DOWN`, `410 EXPIRED_TOKEN`, `403 ACCESS_DENIED` ou `200 { token, tokenId, expiresAt, workspace: { id, slug, name }, scopes, modules }` |
| `/device` (página) | o usuário digita ou confirma o código, escolhe workspace, módulos e escopo (pt-BR, os dois temas, mobile) |
| `GET/POST /api/users/me/api-tokens`, `DELETE /api/users/me/api-tokens/{id}` | Tokens de API do usuário (Ajustes › Segurança); o valor só volta na criação |
| `GET /api/workspaces/{id}/api-tokens`, `DELETE .../{tokenId}` | OWNER/ADMIN veem e revogam os tokens de todos os membros |

Rotas internas da fatia, além do contrato acima: `POST /api/device/authorize`
(resposta da página `/device`, com sessão) e `GET /api/users/me/api-tokens/workspaces`
(workspaces e módulos que o formulário de criação oferece).

Token: `stl_pat_<43 caracteres aleatórios>` (32 bytes em base64url), guardado
como SHA-256. Escopos `api:read` (obrigatório) e `api:write`. Validade padrão
90 dias, máximo 365. O `prefix` exibido é `stl_pat_` + os 8 primeiros
caracteres aleatórios. Até 50 tokens ativos por usuário
(`API_TOKEN_LIMIT_REACHED`).

Fluxo de dispositivo:

- `POST /api/v1/auth/device` aceita `{ clientName?, deviceName? }`, ambos
  opcionais (corpo vazio também vale). `deviceName` é o nome da máquina: o
  token se chama "Steel CLI — <deviceName>". `clientName` (ex.:
  `steel-cli/1.2.0`) só vai para a auditoria. `verificationUri` e
  `verificationUriComplete` são URLs absolutas montadas de `BETTER_AUTH_URL`
  (https fora do ambiente local). Código do usuário com 8
  caracteres sem vogais nem `0/1`, exibido como `BCDF-GH23`; vale 10 minutos;
  `interval` 5 s.
- `POST /api/v1/auth/device/token` responde nos códigos do contrato, em
  `error.code`: `AUTHORIZATION_PENDING` (428), `SLOW_DOWN` (429),
  `EXPIRED_TOKEN` (410), `ACCESS_DENIED` (403).
  `SLOW_DOWN` soma 5 s ao intervalo e traz o novo valor em
  `error.details.interval`. Código desconhecido ou já usado também é
  `410 EXPIRED_TOKEN` (o CLI recomeça o login). O token é emitido na
  consulta que encontra o login aprovado, uma vez só; se o usuário perdeu o
  acesso entre a aprovação e a consulta, a consulta devolve o erro do
  emissor (`FORBIDDEN`, `MODULE_DISABLED`, `API_TOKEN_LIMIT_REACHED`).
- Estado em Redis, não no plugin `device-authorization` do Better Auth: o
  plugin devolve um token de sessão e não guarda workspace, módulos nem
  escopo. Detalhes em `src/cache/device-authorization.cache.ts`.
- Rate limit por IP: 10 inícios a cada 10 minutos, 120 consultas por minuto;
  `/device` e `/api/device/authorize`: 20 por usuário a cada 10 minutos.

`src/lib/api/session.ts`: `ApiSession` e `resolveApiSession(request)`. A
fatia `api-tokens` implementa; as outras só consomem (nos testes, mock).
`resolveApiSession` já consome o limite **por token** (`apiTokenLimiter`, 300
chamadas por minuto, `429 RATE_LIMITED`); as rotas v1 só acrescentam o
`apiLimiter` por usuário. Os módulos da sessão já vêm filtrados pelos que
continuam habilitados no workspace.

## API v1 (fatia `api-v1`)

Prefixo `/api/v1`, só com token pessoal (`Authorization: Bearer stl_pat_...`;
cookie não vale). Envelope igual ao resto da API
(`{ success, statusCode, data | error }`). Paginação por cursor:
`?limit=` (padrão 25, máximo 100) e `?cursor=`; resposta com
`data.items` e `data.nextCursor`. Escrita exige `api:write`.

| Método e rota | Uso no CLI |
| --- | --- |
| `GET /api/v1/me` | `steel whoami`: usuário, workspace, escopos, módulos, validade do token |
| `GET /api/v1/servicedesk/tickets` | `steel sd ticket list` (filtros: status, fase, prioridade, responsável, texto) |
| `GET /api/v1/servicedesk/tickets/{id}` | `steel sd ticket view` (aceita id ou número) |
| `POST /api/v1/servicedesk/tickets` | `steel sd ticket create` |
| `POST /api/v1/servicedesk/tickets/{id}/comments` | `steel sd ticket comment` (público ou interno) |
| `POST /api/v1/servicedesk/tickets/{id}/phase` | `steel sd ticket move` |
| `GET /api/v1/servicedesk/catalog` | serviços e categorias para o `create` |
| `GET /api/v1/crm/leads`, `POST /api/v1/crm/leads` | `steel crm lead list/create` |
| `POST /api/v1/crm/leads/import` | `steel crm lead import <csv>` (até 5.000 linhas; resposta com criados, ignorados e erros por linha) |
| `GET /api/v1/crm/opportunities`, `POST /api/v1/crm/opportunities/{id}/stage` | `steel crm opportunity list/move` |
| `GET /api/v1/crm/pipelines` | funis e etapas |
| `GET /api/v1/whatsapp/templates` | templates aprovados |
| `POST /api/v1/whatsapp/messages/template` | `steel zap send --template` |
| `GET /api/v1/whatsapp/broadcasts/{id}` | `steel zap broadcast status` |

Detalhes de cada rota (fatia `api-v1`):

- `GET /api/v1/me` → `data` = `{ user: { id, name, email }, workspace: { id,
  slug, name }, role, scopes, modules, token: { id, expiresAt } }` (componente
  `Me`; `role` é o papel no workspace).
- `GET /api/v1/servicedesk/tickets`: `status` (categorias de fase em CSV:
  `NEW`, `IN_PROGRESS`, `WAITING`, `RESOLVED`, `CLOSED`, `CANCELED`; omitido =
  só os abertos), `type` (CSV), `phaseId`, `priorityId`, `assigneeId` (CSV;
  aceita `me` e `unassigned`), `q`. Cursor = o da lista do app (id).
- `POST /api/v1/servicedesk/tickets`: o corpo da abertura no app; canal `API`
  quando o corpo não informa outro.
- `POST .../tickets/{id}/comments`: `{ body, visibility: PUBLIC | INTERNAL }`
  (padrão `PUBLIC`), sem anexos. `POST .../tickets/{id}/phase`: o corpo da
  mudança de fase do app (`{ phaseId, solution?, solutionClassificationId?,
  comment? }`). `{id}` aceita id, número ou código.
- `GET /api/v1/servicedesk/catalog?ticketType=`: lista plana (`level` +
  `parentId`) de categorias, subcategorias e serviços ativos.
- `POST /api/v1/crm/leads/import?source=`: o corpo é o próprio CSV
  (`Content-Type: text/csv`, até 5 MB e 5.000 linhas, `,` ou `;`). Colunas:
  `name`/`nome` (obrigatória), `email`, `phone`/`telefone`/`celular`,
  `company`/`empresa`, `job_title`/`cargo`, `city`/`cidade`, `linkedin`,
  `source`/`origem`, `channel`/`canal`; vários e-mails/telefones na célula
  separados por `;`. Cada linha passa pela entrada única de leads, em ordem.
  Resposta `{ total, created, skipped, errors: [{ row, code, message }] }`
  (`skipped` = já existe lead em aberto com o contato; `row` = linha do CSV,
  cabeçalho = 1). Origem padrão: `?source=`, senão `API`.
- `GET /api/v1/crm/opportunities?pipelineId=&stageId=`;
  `POST .../opportunities/{id}/stage` com `{ stageId, pipelineId? }`.
- `GET /api/v1/crm/pipelines`: cada funil com `stages` em ordem.
- `GET /api/v1/whatsapp/templates?status=&connectionId=`: `status` padrão
  `APPROVED`; `ALL` lista todos.
- `POST /api/v1/whatsapp/messages/template`: um destino — `{ conversationId }`,
  `{ contactId, connectionId }` ou `{ to, connectionId? }` (`to` em E.164,
  `+5511999990000`; acha ou cria o contato) — mais `{ templateName, language,
  components? }`. Contato e número usam a conversa aberta do contato ou abrem
  uma. Sem `connectionId`, `to` usa a única conexão do workspace (a única
  `CONNECTED`, se houver várias); nenhuma ou mais de uma possível:
  `422 VALIDATION_ERROR` com mensagem em pt-BR.
- Erros próprios da v1: `403 API_TOKEN_SCOPE_REQUIRED` (escrita sem
  `api:write`) e `403 API_TOKEN_MODULE_NOT_ALLOWED` (módulo fora do token).
  Escritas passam pelo gate de consentimento LGPD, como no app.
- Listas que o service devolve inteiras (leads, oportunidades, funis,
  catálogo, templates) paginam em memória: o cursor é opaco e codifica a
  posição. Cursor inválido: `422 VALIDATION_ERROR`.
- Limites: o por token (300/min) é consumido por `resolveApiSession`; as rotas
  somam o por usuário (`apiLimiter`, o mesmo do app).

Documento: `public/openapi.v1.json`, gerado por `pnpm openapi:generate` (de
`src/openapi/v1/`), servido em `/dev/api/v1/openapi.json` e renderizado em
`/dev/api/v1`. Os paths vêm completos (`/api/v1/...`) e os `servers` são os
hosts, como o SDK espera; os nomes dos componentes `SuccessEnvelope`,
`ErrorEnvelope`, `ApiScope`, `ModuleKind`, `WorkspaceRef`,
`DeviceAuthorizationRequest`, `DeviceAuthorization`, `DeviceToken` e `Me`
são tipos exportados pelo SDK e não mudam. O documento também descreve as
rotas do fluxo de dispositivo (`/auth/device`, `/auth/device/token`,
`DELETE /auth/token`). O CI (`pnpm openapi:v1:compat --base <sha>`, no job
"Lint & Type Check") compara a v1 gerada com a commitada na base do PR (ou no
push anterior) e falha em mudança incompatível: rota, operação, status de
sucesso ou campo removido, tipo mudado, campo de resposta que deixa de vir,
entrada que passa a ser obrigatória ou aceita menos valores (ADR 0035).

## Webhooks de saída (fatia `webhooks-out`)

| Rota | O que faz |
| --- | --- |
| `GET /api/v1/webhooks/events` | catálogo: `{ type, module, description }` |
| `GET/POST /api/v1/webhooks/endpoints`, `PATCH/DELETE .../{id}` | endpoints do workspace (OWNER/ADMIN; `api:write` para mudar) |
| `POST /api/v1/webhooks/endpoints/{id}/test` | envia um evento `steel.ping` |
| `GET /api/v1/webhooks/deliveries?endpointId=` | log de entregas |
| `POST /api/v1/webhooks/deliveries/{id}/retry` | reenvio manual |
| `GET /api/v1/webhooks/listen?events=` | SSE com os eventos do workspace, para `steel listen` |
| `POST /api/v1/webhooks/trigger` | dispara um evento de teste de um tipo do catálogo, para `steel trigger` |

Corpo do evento: `{ id, type, createdAt, workspaceId, data }`. Cabeçalhos:
`Steel-Webhook-Id`, `Steel-Webhook-Timestamp`, `Steel-Signature`
(`v1=<hex do HMAC-SHA256 de "<timestamp>.<corpo>">`). No SSE, cada mensagem
traz o corpo e os mesmos três valores, para o CLI repassar idêntico.

Detalhes fechados na fatia `webhooks-out`:

- Catálogo: `src/lib/webhooks/events.ts` (tipos, módulo, descrição pt-BR,
  schema Zod do `data` e dados de exemplo). `steel.ping` existe, mas não é
  assinável. Endpoint assina tipos ou `*`. Até 20 endpoints por workspace.
- Tudo é OWNER/ADMIN, inclusive `listen` e `trigger`. Na v1, os eventos de
  módulos fora do token não aparecem no catálogo nem no `listen`, e o
  `trigger` deles responde `403`.
- `listen`: a primeira mensagem é `event: ready` com
  `{ workspaceId, events, secret }`; depois cada `event: webhook` (com `id:`)
  traz `{ id, timestamp, signature, body }`. O segredo da escuta é derivado do
  segredo do servidor por membro e workspace: fixo entre sessões, nada
  guardado. Heartbeat `: ping` a cada 25 s.
- `trigger` `{ type, endpointId? }` → `202 { event: { id, type }, deliveries }`:
  dados de exemplo do catálogo; vai para os ouvintes e, com `endpointId`, para
  esse endpoint, nunca para os outros inscritos.
- `endpoints/{id}/test` envia o `steel.ping` na hora (uma tentativa, mesmo
  desativado) e devolve a entrega; não conta para a desativação automática.
- `deliveries` pagina por cursor como o resto da v1 (`limit`, `cursor`,
  `status`, `endpointId`); `retry` responde `202` com a entrega em `PENDING`.
- Criar e trocar o segredo devolvem `{ endpoint, secret }`; a tela tem ainda
  rotas de sessão em `/api/workspaces/{id}/webhooks/**` (revelar o segredo
  com auditoria, trocar, testar, log e reenvio).

## CLI e SDK (repo `steel-so/steel-cli`)

| Fatia | Fase do plano | Entrega |
| --- | --- | --- |
| `cli-core` | 4 | monorepo, SDK gerado do `openapi.v1.json`, `steel login/logout/whoami`, perfis, `steel api`, `--json`, tema, autocomplete, CI |
| `cli-domain` | 5 | comandos de ServiceDesk, CRM e Comunicação da tabela acima |
| `cli-listen` | 5 | `steel listen --forward <url>` e `steel trigger <evento>` |
| `cli-tui` | 6 | `steel` sem argumentos: painel interativo |
| `cli-dist` | 7 | binários, npm, Homebrew, assinatura, `steel mcp`, `/dev/cli`, changelog |

## Fatias no repo `steel`

| Fatia | Onda | Entrega |
| --- | --- | --- |
| `api-tokens` | 1 | `ApiToken`, fluxo de dispositivo, `/device`, Tokens de API (usuário e workspace), `resolveApiSession` |
| `api-v1` | 1 | rotas da tabela "API v1", `openapi.v1.json`, verificação de compatibilidade no CI, `/dev/api/v1` |
| `webhooks-out` | 1 | ADR 0036 inteira: catálogo, endpoints, fila, log, tela, SSE de escuta, gatilho de teste |
