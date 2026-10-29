# Pesquisas NPS / CSAT / CES (T1)

Pesquisa de satisfação disparada pelo fim de uma conversa do zap ou pela
resolução de um chamado do ServiceDesk, respondida por botão/número no WhatsApp
ou por link no e-mail. Rótulo `2026.03.11.1`.

## Modelo

Migração `nov_t1_nps_survey` (blocos `// nov: t1-nps-whatsapp` no schema):

- `SatisfactionSurveyConfig` — uma regra por `(workspace, gatilho)`; **desligada
  por padrão** (gate de terceiros: nada é enviado até um admin ligar).
- `SatisfactionSurvey` — convite + resposta. Guarda *snapshots* de nome
  (atendente/técnico, equipe, cliente) para o relatório sobreviver a renomeações.
  `token` único é o acesso do link público do e-mail.

## Fluxo

1. **Gatilho**: `applyClose` (`whatsapp-conversation.service.ts`) e a transição
   de fase para RESOLVED/CLOSED (`SdTicketEngine.changePhase`) chamam
   `SatisfactionSurveyService.onConversationClosed` / `onTicketResolved`. Falha
   nunca derruba o encerramento (só `logger.warn`).
2. **Agendamento** (`schedule`): respeita o intervalo por cliente
   (`cooldownDays`), escolhe o canal (WhatsApp se há conexão + telefone, senão
   e-mail), grava `SCHEDULED` e enfileira `deliver-survey` com `delay` na fila
   `satisfaction-survey` (`jobId = survey-<id>`).
3. **Envio** (`deliver`, worker): ignora vencida ou chamado já avaliado no portal;
   envia botões (CSAT/CES) ou texto (NPS) via `WhatsAppSend`; se falhar e a regra
   permitir, cai para e-mail; senão `FAILED` com o motivo.
4. **Resposta no WhatsApp**: o webhook chama `handleInbound` **antes** de abrir ou
   reabrir conversa. Botão (`stl:s:<id>:<nota>`), número digitado (com pesquisa
   aberta do telefone) ou comentário (30 min após a nota) são gravados na
   pesquisa e **não** criam mensagem nem reabrem a conversa.
5. **CSAT de chamado** é espelhado em `SdTicket.csatScore/csatComment` (reuso do
   CSAT do ServiceDesk).

## Decisões

- Botões do WhatsApp são no máximo 3: CSAT usa 1/3/5 e CES 2/4/6; NPS (11
  valores) só por número digitado.
- Permissões: leitura/relatório exigem `conversations` × `VIEW`, envio avulso
  `conversations` × `EDIT`, regras só OWNER/ADMIN (módulo Comunicação).
- Chamados sem WhatsApp vinculado usam e-mail do contato ou do solicitante.
- `public/openapi.json` regenerado; rotas em `src/openapi/paths/whatsapp/surveys.ts`.

## Fora do escopo

Alerta de detrator, envio avulso pela interface (só API) e pesquisa por
transcrição/voz.
