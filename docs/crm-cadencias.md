# Cadências de vendas (CRM)

Sequências de passos (e-mail, WhatsApp, tarefa) executadas lead a lead. Entregue na fatia `c1-sales-cadences` (rótulo 2026.07.11.3).

## Modelo

| Tabela | Papel |
| --- | --- |
| `crm_cadences` | A cadência: remetente, conexão do WhatsApp, janela de envio (horário de Brasília), `stop_on_reply`, status `ACTIVE`/`PAUSED`/`ARCHIVED` (exclusão lógica em `deleted_at`) |
| `crm_cadence_steps` | Passos em ordem (`position`). `delay_*` conta a partir do passo anterior; o primeiro, da inscrição. O corpo aceita `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{cargo}}`, `{{cidade}}`, `{{responsavel}}` |
| `crm_cadence_enrollments` | Lead x cadência (único). `next_position` e `next_run_at` dizem qual passo roda e quando; `claimed_at` é a reivindicação do worker |
| `crm_cadence_runs` | Histórico: um registro por passo executado (`SENT`, `SKIPPED`, `FAILED`) |

## Execução

- Fila `crm-cadences`, tick a cada minuto (`CrmCadencesCron`), processador `src/lib/queue/processors/crm-cadences.ts`, serviço `CrmCadenceRunService`.
- O tick reivindica até 200 inscrições vencidas com `FOR UPDATE SKIP LOCKED` (só de cadências `ACTIVE`). Uma reivindicação com mais de 10 min é tomada de novo.
- Cada passo termina numa transação que avança a inscrição e grava o histórico, **só se** a inscrição ainda estiver `ACTIVE` na mesma posição: uma parada que chegou no meio vence. Uma queda do processo entre o envio e essa transação repete o passo (mensagem duplicada possível, caso raro e documentado no serviço).
- Falha de dado (sem e-mail, descadastro, template recusado) pula/falha o passo e avança. Falha transitória (limite de envio, banco, conexão do WhatsApp caída) reagenda o mesmo passo (10 min; 30 min para a conexão).
- Fora da janela, e-mail e WhatsApp esperam `nextSendWindowOpen` (reaproveita `src/lib/crm-campaign/send-window.ts`). Tarefas não esperam.
- O e-mail usa o mesmo remetente e a mesma checagem de domínio verificado das campanhas (ADR 0055), `Reply-To` da cadência ou do responsável pelo lead e respeita `crm_email_opt_outs`. O WhatsApp respeita `broadcast_opted_out_at` do contato. O custo entra na análise como `CRM_CAMPAIGN`.
- Cada toque grava uma tentativa de contato no lead (`crm_lead_contact_attempts`), sem mudar a etapa dele.

## Parada por resposta

`CrmCadenceReplyService` (nunca falha quem o chama):

- WhatsApp: `WhatsAppWebhookService.ingestInboundMessage` chama `onWhatsAppReply(workspaceId, waId)` (fora do ServiceDesk). O telefone do lead é comparado pelos últimos 10 dígitos, em SQL, então máscara e DDI não atrapalham.
- E-mail: `CrmEmailMessageService.create` chama `onEmailReply` quando a direção é `INBOUND`.
- Manual: a ação `replied` da inscrição.
- Também encerram: lead fechado ou excluído (verificado a cada passo) e cadência arquivada.

## API

Documentada em `src/openapi/paths/crm/cadences.ts` (tag *CRM · Leads*, recurso de permissão `leads`).

- `GET/POST /workspaces/{id}/crm/cadences`, `GET/PATCH/DELETE .../cadences/{cadenceId}`
- `GET/POST /workspaces/{id}/crm/cadence-enrollments`, `PATCH .../cadence-enrollments/{enrollmentId}` (`stop`, `pause`, `resume`, `replied`)

Permissões: ver = `VIEW`; criar = `CREATE`; editar, pausar e inscrever = `EDIT`; arquivar = `DELETE` (Membro não exclui).

## Interface

`CRM › Cadências` (`app/_components/crm/cadences/`) e a seção **Cadências** do painel lateral do lead (`LeadCadencePanel`). Manual do usuário em `content/docs/crm/cadencias-de-vendas.mdx`.

## Limites e decisões

- Até 20 passos por cadência e 200 leads por inscrição em lote.
- Conexão Meta exige template aprovado por passo (fora da janela de 24 h só template entrega); Z-API envia texto livre.
- Sem pixel de abertura nem rastreio de clique nos e-mails: a cadência é 1:1, o sinal que importa é a resposta.
- Resposta por e-mail só é detectada quando a mensagem é registrada no CRM (sincronização ou API); a ação manual cobre o resto.
