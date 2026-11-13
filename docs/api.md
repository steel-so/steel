# API — documentação OpenAPI

A referência da API (`public/openapi.json`, OpenAPI 3.1) é **gerada** a
partir do código em `src/openapi/`. Não edite o JSON à mão: um teste unitário
compara o arquivo commitado com a saída do gerador e falha se divergirem.

- Visualização: Scalar em [`/dev/api`](http://localhost:3001/dev/api)
  (pública, em todos os ambientes; `app/(web)/dev/api/route.ts`), lendo
  `/dev/api/openapi.json` — a cópia pública do spec, sem as rotas do painel
  admin (`/admin/**`) nem os coletores de status, e com o servidor apontando
  para o próprio site (`src/lib/docs/public-openapi.ts`). O endereço antigo
  `/reference` redireciona para lá.
- Servidores declarados: local (`http://localhost:3001/api`) e homologação
  (`https://homologacao.stratustelecom.com.br/api`). Os paths do spec são
  relativos a `/api`.
- `info.version` é a tag CalVer derivada do `version` do `package.json`
  (ADR 0003); `pnpm version:sync` continua funcionando.

## Guias para desenvolvedores (`/dev`)

Além da referência, `/dev` tem guias em pt-BR para quem integra com o Steel
(autenticação, envelope e erros, limites, paginação, webhooks e guias por caso
de uso). Cada guia é um MDX em `content/dev/<caminho>.mdx`, servido em
`/dev/<caminho>`, com frontmatter validado por
`src/schemas/dev-page.schema.ts` (`title`, `description`, `section` — o grupo
da barra lateral — e `order`).

- A tabela de códigos de erro é o componente `<ErrorCodeTable />`, gerado de
  `src/errors/codes.ts` (`src/lib/dev/error-catalog.ts`): nunca escreva a
  tabela à mão.
- `src/lib/__tests__/dev-content.test.ts` compila cada guia, confere links e
  âncoras e casa **toda** chamada `/api/...` dos guias (e da página `/dev`) com
  `public/openapi.json`, incluindo o método quando ele aparece (`curl -X`,
  `method:` do fetch, `requests.post(`, linha `POST /api/...`). Rota renomeada
  ou removida quebra o teste até o guia ser corrigido. Os limites citados em
  `content/dev/limites.mdx` são conferidos contra `src/lib/rate-limit.ts`.
- Placeholders de caminho: `<token>`, `$VAR` ou `${var}` valem um segmento;
  `/api/workspaces/<id>/...` indica uma família de rotas.

## Comandos

```bash
pnpm openapi:generate          # reescreve public/openapi.json e mostra a cobertura
pnpm openapi:generate --check  # só confere (exit 1 se estiver desatualizado)
pnpm vitest --project unit src/openapi   # testes de guarda
```

## Como funciona

```
src/openapi/
  registry.ts          registerRoute(...) → operação OpenAPI (params, body, respostas, erros)
  json-schema.ts       Zod → JSON Schema (z.toJSONSchema nativo do Zod 4)
  errors.ts            catálogo de erros derivado de src/errors/codes.ts
  tags.ts              tags + grupos (x-tagGroups) da navegação
  common.ts            conjuntos de erro reusados, upload multipart, dto()
  schemas/*.ts         DTOs de resposta em Zod (as interfaces de types/ não têm Zod)
  paths/auth.ts        Better Auth (/auth/*)
  paths/core.ts        usuário, workspaces, projetos, cobrança, status, legado
  paths/admin.ts       painel admin global (/admin/*)
  paths/public.ts      APIs públicas do CRM (/crm/*)
  paths/crm.ts         CRM interno (/workspaces/{id}/crm/**)       ← a preencher
  paths/whatsapp.ts    Comunicação (/workspaces/{id}/whatsapp/**, /whatsapp/**) ← a preencher
  paths/servicedesk.ts ServiceDesk — junta as listas por fatia de
                       paths/servicedesk/*.ts (config, directory, ticket-tabs,
                       dashboards-portal, whatsapp-ai)
  paths/servicedesk-tickets.ts  chamados, visões salvas e SSE do ServiceDesk
  undocumented/*.ts    operações ainda sem documentação (só encolhe)
  route-inventory.ts   varre app/api/**/route.ts (métodos exportados → paths)
  document.ts          monta o documento (ordenado, determinístico)
scripts/generate-openapi.ts
```

O que o registry gera sozinho, a partir da configuração da rota:

- **Envelope**: `responses[200].schema` descreve só o `data`; o envelope
  `{ success, statusCode, data }` é aplicado (`envelope: false` para Better
  Auth, binários e redirects). `schema: null` documenta `data: null`.
- **Erros**: `auth: 'session'` → `401 UNAUTHORIZED`; `consent: true` → `403
  FORBIDDEN` (consentimento LGPD); corpo/query Zod → `422 VALIDATION_ERROR`;
  rate limit (padrão `user` em rotas com sessão) → `429 RATE_LIMITED` com
  `Retry-After`. Os códigos de `errors: [...]` são agrupados por status com
  exemplos; o status vem de `ERROR_CODES` e a mensagem de exemplo, das
  fábricas de `app-error.ts`. Respostas de erro idênticas viram
  `components.responses`.
- **Parâmetros de path**: extraídos de `{x}`; `{id}` sob `/workspaces/{id}` e
  `/admin/workspaces/{id}` usa o parâmetro comum `WorkspaceId`; os demais
  exigem descrição em `params` (o gerador falha sem ela).
- **Schemas**: bodies e queries usam `io: 'input'` (antes de `default`,
  `transform`, `coerce`); respostas, `io: 'output'`. `z.date()` vira
  `string`/`date-time`. Schemas com `.meta({ id })` (use `dto('Nome', schema)`)
  viram `components.schemas.Nome` + `$ref`.

## Documentando uma rota nova

1. Crie a rota em `app/api/.../route.ts` como sempre.
2. Registre a operação no arquivo do domínio em `src/openapi/paths/`:

   ```ts
   {
     method: 'post',
     path: '/workspaces/{id}/crm/leads',        // relativo a /api, {param} como a pasta [param]
     tags: ['CRM · Leads'],                      // tags existentes em tags.ts
     summary: 'Criar lead',                      // pt-BR, curto
     description: 'Regras de negócio relevantes para quem integra.',
     body: CreateCrmLeadSchema,                  // o MESMO schema Zod que a rota usa no safeParse
     responses: { 201: { description: 'Lead criado.', schema: CrmLeadDTO } },
     errors: [...MODULE_MEMBER_ERRORS, 'CRM_LEAD_DUPLICATE'],
   }
   ```

   - Rota pública: `auth: 'public'` (e `rateLimit: 'ip'` se ela limita por IP).
   - Rota que chama `requireConsent`: `consent: true`.
   - Resposta sem Zod? Crie o DTO em `src/openapi/schemas/<domínio>.ts` com
     `dto('Nome', z.object(...))`, espelhando `types/*.d.ts`/o mapper; se não
     compensar, descreva o `data` com JSON Schema cru e uma boa descrição.
3. Se a operação estava em `src/openapi/undocumented/*.ts`, **remova a linha**.
4. `pnpm openapi:generate` e commite o `public/openapi.json` junto.

## Testes de guarda (`src/openapi/__tests__/openapi.test.ts`)

- `public/openapi.json` é exatamente a saída do gerador (e o gerador é
  determinístico).
- Todo método exportado (`GET|POST|PUT|PATCH|DELETE|HEAD`) de todo
  `app/api/**/route.ts` tem operação documentada **ou** está listado em
  `undocumented/`. Catch-alls (`[...all]`) contam como documentados por
  qualquer operação sob o prefixo (ex.: `/auth/*`).
- Toda operação documentada corresponde a uma rota real (nada obsoleto).
- As listas de `undocumented/` só encolhem: falham se contiverem uma operação
  já documentada, uma rota que não existe mais, ou algo fora do domínio do
  arquivo (`crm.ts` só `/workspaces/{id}/crm/**`; `whatsapp.ts` só
  `/workspaces/{id}/whatsapp/**` e `/whatsapp/**`). Rotas novas nascem
  documentadas.
- Todo `$ref` resolve, toda tag usada está declarada e os `operationId` são
  únicos.

## Conflitos de merge

`public/openapi.json` é gerado: em conflito, resolva os arquivos de
`src/openapi/` e rode `pnpm openapi:generate` — nunca edite o JSON.
