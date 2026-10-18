# Steel CLI — contrato

Contrato entre as fatias do Steel CLI: API pública v1 e tokens pessoais
(ADR 0035), webhooks de saída (ADR 0036) e o CLI/SDK em `steel-so/steel-cli`
(ADR 0034). Mudou o contrato, mude aqui primeiro. Plano aprovado:
"Plano — Steel CLI" (Claude Docs, 2026-10-17).

## Autenticação (fatia `api-tokens`)

| Rota | O que faz |
| --- | --- |
| `POST /api/v1/auth/device` | inicia o login do CLI: `{ deviceCode, userCode, verificationUri, verificationUriComplete, interval, expiresIn }` |
| `POST /api/v1/auth/device/token` | o CLI consulta com `{ deviceCode }`: `428 AUTHORIZATION_PENDING`, `429 SLOW_DOWN`, `410 EXPIRED_TOKEN`, `403 ACCESS_DENIED` ou `200 { token, tokenId, expiresAt, workspace: { id, slug, name }, scopes, modules }` |
| `/device` (página) | o usuário digita ou confirma o código, escolhe workspace, módulos e escopo (pt-BR, os dois temas, mobile) |
| `GET/POST /api/users/me/api-tokens`, `DELETE /api/users/me/api-tokens/{id}` | Tokens de API do usuário (Ajustes › Segurança); o valor só volta na criação |
| `GET /api/workspaces/{id}/api-tokens`, `DELETE .../{tokenId}` | OWNER/ADMIN veem e revogam os tokens de todos os membros |

Token: `stl_pat_<32+ caracteres aleatórios>`, guardado como hash. Escopos
`api:read` e `api:write`. Validade padrão 90 dias, máximo 365.

`src/lib/api/session.ts`: `ApiSession` e `resolveApiSession(request)`. A
fatia `api-tokens` implementa; as outras só consomem (nos testes, mock).

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

Documento: `public/openapi.v1.json`, servido em `/dev/api/v1/openapi.json` e
renderizado em `/dev/api/v1`. O CI compara a v1 com a versão anterior
commitada e falha em mudança incompatível (ADR 0035).

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
