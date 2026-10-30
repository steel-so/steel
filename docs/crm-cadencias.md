# Cadências de vendas (CRM)

Sequências de passos (e-mail, WhatsApp, tarefa) executadas lead a lead. Entregue na fatia `c1-sales-cadences` (rótulo 2026.07.11.3).

## Modelo

| Tabela | Papel |
| --- | --- |
| `crm_cadences` | A cadência: remetente, conexão do WhatsApp, janela de envio (horário de Brasília), `stop_on_reply`, `stop_on_click`, status `ACTIVE`/`PAUSED`/`ARCHIVED` (exclusão lógica em `deleted_at`) |
| `crm_cadence_steps` | Passos em ordem (`position`). `delay_*` conta a partir do passo anterior; o primeiro, da inscrição. O corpo aceita `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{cargo}}`, `{{cidade}}`, `{{responsavel}}` |
| `crm_cadence_enrollments` | Lead x cadência (único). `next_position` e `next_run_at` dizem qual passo roda e quando; `claimed_at` é a reivindicação do worker |
| `crm_cadence_runs` | Histórico: um registro por passo (`PENDING` enquanto o envio não foi confirmado, depois `SENT`, `SKIPPED`, `FAILED`). Passos que enviam mensagem têm `idempotency_key` único (`<inscrição>:<posição>`), `provider_message_id` e, nos e-mails, `opened_at`/`clicked_at`/`open_count`/`click_count` |

## Execução

- Fila `crm-cadences`, tick a cada minuto (`CrmCadencesCron`), processador `src/lib/queue/processors/crm-cadences.ts`, serviço `CrmCadenceRunService`.
- O tick reivindica até 200 inscrições vencidas com `FOR UPDATE SKIP LOCKED` (só de cadências `ACTIVE`). Uma reivindicação com mais de 10 min é tomada de novo.
- Cada passo termina numa transação que avança a inscrição e grava o histórico, **só se** a inscrição ainda estiver `ACTIVE` na mesma posição: uma parada que chegou no meio vence. O envio em si é protegido contra duplicidade (próxima seção).
- Falha de dado (sem e-mail, descadastro, template recusado) pula/falha o passo e avança. Falha transitória (limite de envio, banco, conexão do WhatsApp caída) reagenda o mesmo passo (10 min; 30 min para a conexão).
- Fora da janela, e-mail e WhatsApp esperam `nextSendWindowOpen` (reaproveita `src/lib/crm-campaign/send-window.ts`). Tarefas não esperam.
- O e-mail usa o mesmo remetente e a mesma checagem de domínio verificado das campanhas (ADR 0055), `Reply-To` da cadência ou do responsável pelo lead e respeita `crm_email_opt_outs`. O WhatsApp respeita `broadcast_opted_out_at` do contato. O custo entra na análise como `CRM_CAMPAIGN`.
- Cada toque grava uma tentativa de contato no lead (`crm_lead_contact_attempts`), sem mudar a etapa dele.

## Sem envio duplicado (follow-up da C1)

Antes de enviar um e-mail ou WhatsApp, o worker grava a **intenção** do passo: uma linha `PENDING` em `crm_cadence_runs` com chave única `<inscrição>:<posição>`. Assim que o provedor responde, o `provider_message_id` é gravado na mesma linha; só então a transação de sempre avança a inscrição e fecha a linha (`SENT`/`FAILED`). Se o processo cair, a reivindicação vencida (10 min) chega ao mesmo passo e a linha diz até onde a tentativa anterior foi:

| Estado da linha ao retomar | O que acontece |
| --- | --- |
| já fechada (`SENT`/`SKIPPED`/`FAILED`) | respeita o resultado e só avança a inscrição, sem enviar |
| `PENDING` com `provider_message_id` | a mensagem saiu: fecha como `SENT` e avança, sem enviar |
| `PENDING` sem id, **e-mail**, com menos de 20 h | repete o envio com a mesma `Idempotency-Key` do Resend (`cadence-<inscrição>-<posição>`); o provedor devolve a primeira mensagem em vez de criar outra |
| `PENDING` sem id, e-mail com mais de 20 h | a chave do provedor pode ter expirado: fecha como `FAILED` ("envio interrompido") sem repetir |
| `PENDING` sem id, **WhatsApp** | não há idempotência no provedor e "nunca saiu" não se distingue de "saiu sem o id": fecha como `FAILED` e não repete |

Falha transitória (limite, conexão) apaga a intenção recém-criada, porque prova que nada saiu, e o passo é repetido do zero. Os testes `crm-cadence-run-intent.service.test.ts` simulam a queda do processo antes e depois de gravar o id, com um provedor que deduplica pela chave. Fora do escopo: o passo de **tarefa** ainda pode criar duas tarefas se o processo cair entre criar e avançar (a tarefa é local e barata de apagar).

## Abertura e clique nos e-mails (follow-up da C1)

- Cada e-mail de cadência leva um **pixel** (`/api/crm/cadences/o/<token>`) e todos os links `http(s)` do corpo passam por `/api/crm/cadences/c/<token>?u=<url>`. O token é `<runId>.<HMAC>` com separação de domínio; o do clique assina também o destino, então a rota nunca vira redirecionador aberto. As duas rotas são públicas (lista `PUBLIC_ROUTES` do `proxy.ts`), o pixel sempre devolve o GIF e o clique redireciona mesmo se o registro falhar.
- Reaproveitamos o desenho do rastreio das campanhas (ADR 0025), mas não a tabela: o destino das campanhas é fixo (página/formulário do CRM), o das cadências é qualquer link escrito pelo vendedor.
- `CrmCadenceTrackingService`: abertura incrementa `open_count` (a primeira grava `opened_at`); clique faz o mesmo em `click_count`/`clicked_at` e marca a abertura se o pixel foi bloqueado.
- **Parar ao clicar** (`stop_on_click`, desligado por padrão): o clique encerra a inscrição aberta com `stop_reason = CLICKED`. Cliques nos primeiros 10 s após o envio contam, mas não encerram (scanners de segurança abrem links na entrega).
- Os números de abertura são estimativas (clientes que pré-carregam imagens inflam, os que bloqueiam subestimam).
- Webhooks de entrega do Resend não entram: só o app lê o pixel e o clique.

## Estatísticas

`GET .../cadences/{cadenceId}` devolve `stats`: inscritos, em andamento, pausados, responderam, concluídos, encerrados (e quantos por clique) e, por passo, `reached` (passou pelo passo), `sent`, `skipped`, `failed`, `opened` e `clicked` (e-mails distintos). A página `CRM › Cadências › Estatísticas` (`/<workspace>/crm/cadences/<id>`) mostra os cartões, o funil por passo e a lista dos inscritos; o histórico de cada inscrição mostra aberturas e cliques por e-mail.

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
- Pixel e clique só nos e-mails (WhatsApp não tem rastreio de link) e só em links `http(s)`; `mailto:` e âncoras passam direto.
- Resposta por e-mail só é detectada quando a mensagem é registrada no CRM (sincronização ou API); a ação manual cobre o resto.
