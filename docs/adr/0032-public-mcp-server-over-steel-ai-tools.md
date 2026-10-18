# 0032 — Servidor MCP público sobre as ferramentas do Steel AI

- **Status:** Aceita
- **Data:** 2026-10-17
- **Decisores:** product owner + time de engenharia

## Contexto

Clientes querem usar o Steel de dentro de Claude, ChatGPT, Cursor e outros
clientes de IA. A API REST tem 731 rotas, 621 delas sob `/workspaces/{id}`,
pensadas para a interface do app: expor uma ferramenta MCP por rota deixaria
o modelo resolvendo IDs, paginação e filtros sozinho.

O Steel AI já tem o que um servidor MCP precisa: 91 ferramentas em
`src/lib/ai/tools/` (43 de leitura), cada uma com descrição para modelo,
JSON Schema, `parse`, `preview` e `execute`, filtradas por módulo e RBAC em
`registry.ts` e executadas com as permissões do usuário (ADR 0018).

## Decisão

**O Steel expõe um servidor MCP remoto em `/api/mcp`, dentro do app, que é
um adaptador sobre o registry do Steel AI.** Não há repositório nem serviço
à parte: o servidor importa o registry e roda no mesmo processo do Next.

Detalhes para aplicar:

- **Transporte:** Streamable HTTP, sem estado (sem sessão MCP no servidor),
  com o SDK oficial `@modelcontextprotocol/sdk`.
- **Autenticação:** OAuth 2.1 do próprio Steel (ADR 0033). O token carrega
  usuário, workspace, escopos e módulos; nada disso vem de argumento de
  ferramenta.
- **`tools/list`:** o filtro do registry (`isToolAllowed`: módulo × RBAC),
  mais os módulos e escopos concedidos ao token. Fora do escopo `mcp:write`,
  só ferramentas `READ`.
- **`tools/call`:** `parse` → `execute` com `AiToolContext.source = 'mcp'`.
  A resposta leva o `data` em `structuredContent` e o `summary` em texto,
  respeitando `TOOL_OUTPUT_MAX_BYTES`.
- **Escrita (`mcp:write`):** o consentimento OAuth com escopo explícito faz o
  papel da confirmação da ADR 0018 para `CREATE`, `UPDATE` e `ACTION`, como o
  Autopilot da ADR 0021. Além do escopo, o admin precisa ligar "Permitir
  escrita via MCP" em Ajustes › Steel IA (desligado por padrão). `DELETE`
  nunca é exposto. Ações que falam com cliente final (mensagem de WhatsApp,
  e-mail) viram `AiPendingAction` e devolvem o link para confirmar no Steel.
  Toda escrita grava `AiActionLog` + `auditMutation`.
- **Recursos e prompts:** artigos publicados da base de conhecimento e
  páginas da Wiki como *resources*; prompts prontos por módulo.
- **Plano:** disponível em todos os planos por enquanto; a cota de IA
  (ADR 0019) não se aplica, porque o modelo é do cliente.
- Rate limit próprio por usuário e por cliente OAuth; logs no Axiom.

## Consequências

- Uma ferramenta nova ou melhorada no Steel AI aparece no MCP no mesmo deploy.
- Não há infraestrutura nova: nada de container, domínio ou deploy extra.
- O MCP herda as limitações do registry: descrições escritas para o prompt
  interno precisam ser revisadas para clientes externos.
- Texto de terceiros (WhatsApp, e-mail, descrições de chamado) chega ao
  modelo do cliente; por isso `DELETE` fica fora e as ações com cliente final
  pedem confirmação.
- O proxy da homologação precisa repassar SSE sem buffering em `/api/mcp`.
- Revisitar o plano em que o MCP entra quando houver uso medido.

## Atualização (18/10/2026)

O número do contexto está errado: quando esta ADR foi aceita, o registry
(`STEEL_AI_TOOLS` em `src/lib/ai/tools/index.ts`) já tinha **98**
ferramentas, não 91. O número muda a cada leva de ferramentas; a lista viva,
com o que cada uma faz, está em `/dev/mcp` (gerada do registry).
