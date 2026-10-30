# Busca em linguagem natural e "Conectar sua IA" (C10)

Duas entregas da mesma feature do ROADMAP (rótulo 2026.04.11.4).

## Busca em linguagem natural nas oportunidades

- Rota: `POST /api/workspaces/{id}/crm/opportunities/search` com `{ query }` (2 a 300 caracteres).
- Fluxo: `CrmNlSearchService.searchOpportunities` checa módulo CRM + permissão `opportunities × VIEW` + feature `crm.aiAssistant` + cota (`AiUsageService.prepare`, mesma do assistente do CRM, ADR 0007). A IA recebe **só a pergunta** (e a data de hoje) e devolve um JSON de filtro (`CrmNlSearchFilterSchema`, validado com Zod). O filtro vira `where`/`orderBy` do Prisma em `src/lib/crm-nl-search.ts` e roda em `CrmOpportunityRepository.search`, sempre com `workspaceId` e `deletedAt: null`. O modelo nunca escreve SQL nem vê dados.
- Resposta: `interpretation` (frases em pt-BR de como a pergunta foi lida, geradas por código a partir do filtro validado, não pelo modelo), o `filter`, as oportunidades (até 200; `truncated`) e a pergunta.
- Decisões: só oportunidades nesta versão (o exemplo do roadmap; leads, pessoas e empresas vieram na seção seguinte); "parado" = `updatedAt` antigo, porque o histórico de etapas não tem coluna própria; sem migração de banco; a pergunta nunca é gravada (o log guarda só o tamanho e a contagem de resultados).
- Erro novo: `CRM_NL_SEARCH_FAILED` (502) para falha do provedor ou saída fora do formato.
- UI: `CrmNlSearchBar` acima da tabela em `CrmOpportunitiesTable`; a tabela filtra pelos ids devolvidos.

## Leads, pessoas e empresas (ai-crm-followups, 30/10/2026)

Mesmo desenho, um filtro validado por registro; nenhum dado do CRM vai ao modelo.

- Rotas: `POST /api/workspaces/{id}/crm/{leads|people|companies}/search` com `{ query }`. As três usam `crmNlSearchRoute` (`src/lib/crm-nl-search-route.ts`: sessão, `aiMessageLimiter`, corpo, serviço) e `CrmNlSearchService.searchLeads/searchPeople/searchCompanies`.
- Serviço: o passo comum (módulo CRM + permissão `<recurso> × VIEW` + feature `crm.aiAssistant` + cota + uma chamada ao modelo com **só a pergunta** e a data) é `interpretQuestion`; `searchOpportunities` passou a usá-lo também, sem mudar de comportamento. O resultado é validado por `CrmNlLeadFilterSchema`/`CrmNlPersonFilterSchema`/`CrmNlCompanyFilterSchema` e traduzido em `where`/`orderBy` por `src/lib/crm-nl-search-entities.ts` (sempre com `workspaceId` e `deletedAt: null`), executado em `CrmLeadRepository.search`/`CrmPersonRepository.search`/`CrmCompanyRepository.search` (até 200 + 1 para marcar `truncated`).
- Campos: **leads** — situação (`OPEN` = qualquer etapa menos Fechado, `WON`, `LOST`, `ANY`) ou etapa, score, criação, parado (`updatedAt`), responsável, e-mail/telefone, canal, origem, cidade, texto (nome, empresa, cargo). **Pessoas** — criação, parado, e-mail/telefone, com/sem empresa, nome da empresa, cargo, cidade, nome. **Empresas** — ICP, funcionários, ARR, CNPJ, "enriquecida" e ramo (`activityContains` busca no CNAE do `CrmCompanyEnrichment`), domínio, criação, parado, responsável da conta, nome/domínio.
- Resposta: `{ query, interpretation, filter, items, truncated }` (`CrmNlEntitySearchResultDTO`); as oportunidades continuam com a chave `opportunities` por compatibilidade. Pessoas e empresas trazem os campos customizados, como a listagem.
- UI: a mesma `CrmNlSearchBar` (prop `entity`) no quadro de leads, na tabela de pessoas e na de empresas; `applyNlResult` filtra as linhas já carregadas e, quando a pergunta pede uma ordem ("maiores primeiro"), segue a ordem do servidor (a tabela de oportunidades passou a fazer o mesmo).
- Decisões: (a) pessoas não têm responsável no modelo, então "minhas pessoas" não existe; (b) "parado" continua sendo `updatedAt` antigo; (c) lead em andamento = qualquer etapa menos Fechado; (d) sem migração; (e) a pergunta nunca é gravada (log só com tamanho e contagem).

## Conectar sua IA (MCP)

- Quadro `McpConnectGuide` em **Ajustes › Apps conectados**, visível para todo membro. Dados dos passos e comandos em `src/lib/mcp/connect-guides.ts` (Claude, ChatGPT, Gemini).
- O endereço é `BETTER_AUTH_URL + /api/mcp`, calculado no servidor.
- O selo "Conectado" usa os grants do próprio usuário (`/api/users/me/integration-grants`) e o `redirectHost` aprovado na tela de consentimento, nunca o nome que o app declara. Gemini CLI conecta por loopback e não é distinguível, então não tem selo.
- O fluxo OAuth e o servidor MCP não mudaram (ADR 0032 e 0033).
