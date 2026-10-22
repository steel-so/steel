# Steel AI — próximos passos

Levantamento de 2026-10-17, feito durante a onda do MCP, e aprovado em
2026-10-18. Atualizado em 2026-10-22: as frentes 1 a 6 estão entregues; resta
a fase 2 da frente 4 (em construção, ADR 0046). Era a lista do que faltava
para o Steel ser ainda mais forte em IA, na ordem sugerida; cada frente ganhou
plano, ADR e contrato próprios.

## O que já existe

- Assistente com os modos explorar, agente, autopilot e teste, com
  confirmação no servidor (ADRs 0018, 0021, 0023).
- Steel Agents com dono, aprovações e gatilho por agendamento ou evento
  (ADR 0020).
- Memória, skills, provedor por workspace e cota de uso (ADRs 0007, 0019,
  0022).
- IA nos módulos: triagem, copiloto e pré-atendimento no ServiceDesk;
  rascunho de artigo (KCS); risco preditivo (ADR 0016); resposta automática e
  sentimento no WhatsApp; assistente do CRM; transcrição de áudio.
- Servidor MCP público sobre as ferramentas do Steel AI (ADRs 0032, 0033).
- Steel CLI e SDK ([ADR 0034](../adr/0034-steel-cli-and-sdk.md)), API v1 com tokens pessoais e webhooks de saída (ADRs 0035 e 0036).

## O que falta, na ordem sugerida

| # | Frente | Problema hoje | O que entregar |
| --- | --- | --- | --- |
| 1 | Base de conhecimento única — **entregue** em 18/10 ([ADR 0037](../adr/0037-unified-knowledge-search-hybrid-pgvector.md); falta instalar o pgvector nos servidores: [runbook](../runbooks/postgres-pgvector.md)) | Não há índice vetorial; cada ferramenta busca por texto no seu canto | Índice semântico (pgvector) de artigos, Wiki, chamados resolvidos, documentos da IA do WhatsApp, notas e propostas do CRM; respeita as permissões do usuário; toda resposta cita a fonte; ferramenta `steel_search` no assistente, nos agentes e no MCP |
| 2 | Avaliação e feedback — **entregue** em 18/10 ([ADR 0039](../adr/0039-steel-ai-feedback-and-evals.md)) | Não há como saber se a IA acerta | 👍/👎 com motivo em toda resposta de IA; conjuntos de teste por workspace; rodar o conjunto antes de trocar modelo, prompt ou skill; painel de qualidade (acerto, resolução sem humano, custo por resolução) |
| 3 | IA proativa — **entregue** em 18/10 ([ADR 0040](../adr/0040-steel-ai-proactive-insights-and-daily-digest.md)) | Quase tudo começa com o usuário perguntando | Feed de alertas ("a fila vai estourar o SLA às 15h", "4 oportunidades sem contato há 10 dias", "sentimento do cliente caiu") e resumo diário por papel, sobre os gatilhos por evento dos Steel Agents |
| 4 | Voz no PABX — **fase 1 entregue** em 18/10 ([ADR 0043](../adr/0043-pabx-call-recording-transcription-and-summary.md); falta aplicar o trecho do PABX: [runbook](../runbooks/pabx-call-recording.md)); fase 2 (atendente de voz na URA) em construção em 22/10 | Click-to-call e transcrição existem, mas a ligação não vira informação | Transcrição e resumo automáticos da ligação no chamado ou na oportunidade, com sentimento e próximos passos; depois, atendente de voz com IA na URA (abre chamado, consulta status, transfere com contexto) |
| 5 | Proteções e LGPD — **entregue** em 18/10 ([ADR 0041](../adr/0041-ai-guardrails-pii-injection-auto-reply-limits.md)) | Dados pessoais e texto de terceiros vão direto ao provedor | Mascarar CPF, cartão e telefone antes de enviar, com política por workspace; detectar prompt injection em conteúdo de terceiros; assuntos proibidos e limite de alçada na resposta automática |
| 6 | Modelo por tarefa e contingência — **entregue** em 18/10 ([ADR 0042](../adr/0042-ai-model-per-task-and-provider-failover.md)) | Um provedor por workspace | Modelo barato para classificação e sentimento, forte para agentes; troca automática de provedor quando um cair |

As frentes 1 a 3 melhoram tudo o que já existe e vêm primeiro. A 4 é o
diferencial de venda para uma empresa de telecom. As frentes 5 e 6 são
menores e podem andar em paralelo.
