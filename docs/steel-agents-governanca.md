# Governança dos Steel Agents (A6, A7, A8)

Funcionalidades: painel de governança, delegação entre agentes e cliente MCP
com permissões de criação. Visão do usuário em
`content/docs/steel-ai/governanca-dos-agentes.mdx`.

## Modelo de dados

- `steel_agent_policies` (1 por workspace): `killedAt/killedById/killReason`
  (desligamento de emergência), `restrictCreators` + `creatorRoles`,
  `restrictAuto` + `autoRules` (JSON por perfil: `ALL | NONE | LIST`).
  Sem linha, ou com os `restrict*` desligados, vale o comportamento anterior
  (matriz RBAC).
- `steel_agent_delegates`: arestas agente → agente (A7).
- `steel_agent_runs.parent_run_id/depth/delegated_cost_usd`.
- `steel_mcp_servers`: URL, cabeçalho e valor cifrado (`CONNECTION_SECRETS`),
  cache de ferramentas e lista de liberadas.

## Desligamento de emergência

Checado no `preflight` do runner, a cada rodada, e na aprovação. `kill` cancela
runs `QUEUED`/`WAITING_APPROVAL` e ações pendentes; é idempotente.

## Delegação

Ferramenta virtual `delegate_to_agent` (não está no registro). Cria uma run
filha (`parentRunId`, `depth`), executa inline com `executeSteelAgentRun` e soma
o custo na run principal (`costUsd` inclui, `delegatedCostUsd` detalha). Limites
em `src/lib/steel-agents/delegation.ts`. Se a filha pausar para aprovação, ela
continua depois de forma independente (o custo posterior não volta para a mãe).
As delegações **não são versionadas** (ficam fora do snapshot da versão).

## MCP

Ferramentas externas viram `mcp_<slug>__<ferramenta>` e entram no runtime como
qualquer ferramenta (`src/services/steel-mcp-tools.ts`). Leitura (`readOnlyHint`)
roda; o resto é escrita e segue aprovação/AUTO. SSRF: mesmo guard dos webhooks
(`checkWebhookUrl`), verificado ao salvar e a cada requisição, sem redirects. A
resolução de DNS não é fixada na conexão (mesmo nível dos webhooks). Simulações
de persona não oferecem ferramentas MCP.
