# IA que executa ações (T3) e agentes sem código para o CRM (C3)

Entregue na fatia `ai-actions` (rótulo 2026.11.11.1 para o T3 e 2026.10.11.3 para o C3).

## T3 — ferramentas `act_*` e conectores HTTP

Nenhum fornecedor é embutido. Um OWNER/ADMIN cadastra **conectores** (Ajustes › Steel IA › Ações da IA) e três ferramentas genéricas do registro (`src/lib/ai/tools/actions.ts`) os chamam:

| Ferramenta | Tipo | Efeito |
| --- | --- | --- |
| `act_list_connectors` | READ | Lista os conectores habilitados (chave, tipo, parâmetros) |
| `act_lookup` | READ | Chama um conector `LOOKUP` (GET) |
| `act_run` | ACTION, `customerFacing` | Chama um conector `ACTION` (POST/PUT/PATCH/DELETE) |

"Abrir chamado" e "criar lead" já existiam (`sd_create_ticket`, `crm_create_lead`) e entram na mesma lista de permissões; consultar pedido, redefinir senha e liberar acesso são conectores.

### Modelo

| Tabela | Papel |
| --- | --- |
| `ai_action_connectors` | Um conector por workspace e `key`: URL com `{param}`, método, parâmetros declarados, cabeçalhos cifrados com `CONNECTION_SECRETS` (nunca devolvidos) |
| `ai_action_settings` | Chave geral (`enabled`, desligada por padrão), lista de permissões da resposta automática (`zap_tools`) e identidade (`zap_actor_id`, OWNER/ADMIN) |
| `ai_action_executions` | Livro de idempotência: `(workspace_id, idempotency_key)` único |

### Segurança

- **SSRF**: o mesmo guarda dos webhooks (`checkWebhookUrl`): só HTTPS, sem credenciais na URL, host público. Vale ao salvar (com os `{param}` trocados) e antes de **cada** chamada; sem redirecionamentos, timeout de 10 s, resposta limitada a 8.000 caracteres. `{param}` só é aceito no caminho e na query, nunca no host, e o valor vai com `encodeURIComponent`.
- **Lista de permissões**: só conectores cadastrados e habilitados são alcançáveis; argumentos não declarados são recusados.
- **Idempotência**: toda ação leva o cabeçalho `Idempotency-Key` (SHA-256 de workspace, conector, argumentos ordenados e escopo — agente ou conversa). O livro reserva a chave (`PENDING`), grava o desfecho e repete o resultado guardado por 24 h. `FAILURE` e `PENDING` com mais de 2 min podem ser tomados de novo.
- **Aprovação**: o modo (AUTO/APPROVAL) vem do modelo de permissões já em produção (A8): `effectiveToolMode` (exclusão sempre pede), trava de conteúdo de terceiros (ADR 0041) e a chave `agentModeEnabled`.
- **Trilha**: `AiActionLog` (nova origem `WHATSAPP`) e `auditMutation` (`ai_action_connector` / `send`; `ai_action_settings`).

### Resposta automática do WhatsApp

`src/lib/whatsapp/ai-reply-tools.ts` entrega à resposta automática as ferramentas da lista (`zap_tools`), executando com as permissões de `zap_actor_id`. Até 3 rodadas de ferramentas (consulta, depois ação); a última é forçada para texto. Escritas `AUTO` só rodam se a conversa não foi marcada como injeção; senão, e em `APPROVAL`, viram `AiPendingAction` em nome da identidade (aparece em **Pendências da IA**, e só ela confirma). Sem chave geral, sem identidade ou sem ferramenta, nada muda no comportamento anterior.

### Rotas

`GET|POST /api/workspaces/{id}/ai/connectors`, `PATCH|DELETE .../ai/connectors/{connectorId}`, `PATCH .../ai/action-settings`. Só OWNER/ADMIN.

### O que o dono precisa fazer

1. Em cada workspace: ligar **Permitir ações da IA**, cadastrar os conectores com o token do sistema do cliente e, para o WhatsApp, escolher as ferramentas e a identidade.
2. Os sistemas do cliente devem aceitar `Idempotency-Key` para que a proteção valha também do lado deles; o Steel já impede a repetição do lado dele por 24 h.

## C3 — agentes sem código para o CRM

- Três modelos novos em `src/lib/ai/templates/crm-sales-agent-templates.ts`, listados pela mesma galeria (`GET /ai/templates`): **Qualificar lead novo** (evento `crm.lead.created`), **Follow-up de vendas** (agenda, dias úteis às 9h) e **Atualizar oportunidade após proposta vista** (evento `crm.proposal.viewed`). Todas as escritas começam como APPROVAL; leituras são AUTO.
- `SteelAgentTemplate` ganhou `triggerType: 'EVENT'` e `eventKey`; o DTO já tinha `eventKey`.
- **Criar com ajuda**: `SteelAgentGuidedDialog` (Agentes › Criar com ajuda) em quatro passos (objetivo, detalhes, autonomia, revisão). A lógica pura está em `src/lib/steel-agents/guided.ts`: o contexto da empresa é anexado às instruções, a frequência vem de três opções, e "Faz o simples sozinho" libera AUTO só para `crm_create_note` e `crm_create_task`. O agente nasce pausado.
