# Busca em linguagem natural e "Conectar sua IA" (C10)

Duas entregas da mesma feature do ROADMAP (rótulo 2026.04.11.4).

## Busca em linguagem natural nas oportunidades

- Rota: `POST /api/workspaces/{id}/crm/opportunities/search` com `{ query }` (2 a 300 caracteres).
- Fluxo: `CrmNlSearchService.searchOpportunities` checa módulo CRM + permissão `opportunities × VIEW` + feature `crm.aiAssistant` + cota (`AiUsageService.prepare`, mesma do assistente do CRM, ADR 0007). A IA recebe **só a pergunta** (e a data de hoje) e devolve um JSON de filtro (`CrmNlSearchFilterSchema`, validado com Zod). O filtro vira `where`/`orderBy` do Prisma em `src/lib/crm-nl-search.ts` e roda em `CrmOpportunityRepository.search`, sempre com `workspaceId` e `deletedAt: null`. O modelo nunca escreve SQL nem vê dados.
- Resposta: `interpretation` (frases em pt-BR de como a pergunta foi lida, geradas por código a partir do filtro validado, não pelo modelo), o `filter`, as oportunidades (até 200; `truncated`) e a pergunta.
- Decisões: só oportunidades nesta versão (o exemplo do roadmap); "parado" = `updatedAt` antigo, porque o histórico de etapas não tem coluna própria; sem migração de banco; a pergunta nunca é gravada (o log guarda só o tamanho e a contagem de resultados).
- Erro novo: `CRM_NL_SEARCH_FAILED` (502) para falha do provedor ou saída fora do formato.
- UI: `CrmNlSearchBar` acima da tabela em `CrmOpportunitiesTable`; a tabela filtra pelos ids devolvidos.

## Conectar sua IA (MCP)

- Quadro `McpConnectGuide` em **Ajustes › Apps conectados**, visível para todo membro. Dados dos passos e comandos em `src/lib/mcp/connect-guides.ts` (Claude, ChatGPT, Gemini).
- O endereço é `BETTER_AUTH_URL + /api/mcp`, calculado no servidor.
- O selo "Conectado" usa os grants do próprio usuário (`/api/users/me/integration-grants`) e o `redirectHost` aprovado na tela de consentimento, nunca o nome que o app declara. Gemini CLI conecta por loopback e não é distinguível, então não tem selo.
- O fluxo OAuth e o servidor MCP não mudaram (ADR 0032 e 0033).
