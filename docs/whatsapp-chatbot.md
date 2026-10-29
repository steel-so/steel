# Chatbot visual da Comunicação (Z2)

Fluxo sem código que atende o contato no WhatsApp antes de uma pessoa ou da IA.
Manual do usuário: `content/docs/comunicacao/chatbots.mdx`. Código:
`src/lib/whatsapp/chatbot/*` (motor puro), `src/services/whatsapp-chatbot*.service.ts`,
UI em `app/_components/whatsapp/chatbots/*` e `zap/chatbots`.

## Modelo

- `whatsapp_chatbots`: nome, gatilho (`NEW_CONVERSATION`, `KEYWORD`,
  `OUTSIDE_BUSINESS_HOURS`), conexão opcional, TTL de sessão, `draft` (o que o
  editor grava) e `published` (cópia congelada que o runtime lê) com
  `publishedVersion`. Status `DRAFT`, `ACTIVE`, `PAUSED`.
- `whatsapp_chatbot_sessions`: uma execução sobre uma conversa. Guarda uma cópia
  do fluxo (`definition`, então republicar não muda sessões em andamento) e o
  `state` do motor. **Um índice único parcial** (`status = 'RUNNING'`) garante
  uma sessão ativa por conversa; a criação concorrente vira `null` e quem perdeu
  reaproveita a vencedora.
- O fluxo é um grafo no formato do React Flow: `nodes` (`start`, `message`,
  `menu`, `question`, `condition`, `set-variable`, `webhook`, `handoff-human`,
  `handoff-ai`, `end`) e `edges` com `sourceHandle` (`next`, id da opção do menu,
  id do ramo da condição, `else`, `invalid`, `error`). Limites em
  `CHATBOT_LIMITS` (100 blocos, 300 ligações, 10 opções por menu).

## Execução

1. O webhook do WhatsApp (`WhatsAppWebhookService.ingestInbound`) chama
   `WhatsAppChatbotRuntimeService.claimInbound` para toda mensagem recebida do
   módulo Comunicação, depois de botões e descadastro. Se um bot assume a
   mensagem (sessão em andamento ou gatilho que bate), `engaged = true` e a
   **resposta automática por IA não é enfileirada**.
2. `claimInbound` cria a sessão (quando é o início) e enfileira
   `run-chatbot-step` na fila `whatsapp-chatbot` (job id por mensagem, evita
   duplicar quando o provedor repete o webhook).
3. O worker (`processWhatsappChatbot`) chama `runStep`: o motor (`startFlow` /
   `resumeFlow`) devolve as saídas e o estado; o service envia (botões de
   resposta quando o menu cabe em 3 opções de até 20 caracteres, senão lista
   numerada; se o provedor recusa botões, cai para a lista), grava as mensagens,
   publica no tempo real e trata o desfecho.
4. A fila roda com **concorrência 1** (padrão do BullMQ): duas respostas do mesmo
   contato nunca avançam a sessão em paralelo. Não aumentar sem trocar por uma
   trava por sessão.

Regras de início: `NEW_CONVERSATION` e `OUTSIDE_BUSINESS_HOURS` só começam
quando a mensagem abriu a conversa (nova ou reaberta); `KEYWORD` começa em
qualquer momento se a conversa não tem atendente e não houve passagem
(`aiHandoff = false`). Uma pessoa que assume cancela a sessão (`CANCELLED`,
`human_took_over`); silêncio maior que o TTL expira (`EXPIRED`) de forma
preguiçosa, na próxima mensagem.

## Passagens

- **Atendente**: equipe (fila + distribuição automática do ADR 0047 + aviso aos
  membros), atendente específico (se ainda for membro) ou fila geral. Desliga a
  IA e marca `aiHandoff`, evento `CHATBOT_HANDOFF` na linha do tempo.
- **IA**: liga `aiActive`, enfileira `generate-ai-reply` com a instrução do
  bloco. Com a IA desligada no workspace, vai para a fila de atendimento.
- Falha de envio, laço (limite de 40 blocos por execução), bloco ausente ou
  resposta inválida sem saída desenhada também terminam em fila de atendimento.

## Integração (webhook)

`callChatbotWebhook` reaproveita a trava SSRF dos botões
(`assertPublicHttpsUrl`): só HTTPS público, sem credenciais na URL, sem
redirecionamento, 8 s, resposta até 256 KB. Não há cabeçalhos configuráveis nem
segredo no desenho do fluxo (decisão: o `draft` é legível por todo membro do
módulo). O simulador nunca chama a URL.

## API

`/api/workspaces/{id}/whatsapp/chatbots[...]`: CRUD, `publish`, `validate`,
`status`, `simulate`, `sessions` (ver OpenAPI). Leitura para membros do módulo;
escrita para dono e administradores. Eventos auditados: `whatsapp_chatbot`
(`create`, `update`, `publish`, `activate`, `pause`, `delete`) e
`whatsapp_chatbot_session` (`finish`).

## Limitações conhecidas

- Os alertas de "conversa aguardando" e o evento
  `communication.conversation.waiting` disparam na abertura da conversa, mesmo
  com o bot conduzindo.
- Sem mídia nem lista interativa da Meta nos menus (botões ou texto numerado).
- Sem autosave no editor; sem teste A/B de fluxos nem métricas por bloco.
