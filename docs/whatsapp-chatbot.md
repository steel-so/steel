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
   resposta quando o menu cabe em 3 opções de até 20 caracteres; senão, na
   conexão **Meta**, uma **lista interativa** (`WhatsAppSend.list`, botão “Ver
   opções”, até 10 linhas; título cortado em 24 caracteres com o texto inteiro
   na descrição); no Z-API, ou se o provedor recusa botões/lista, a lista
   numerada em texto), grava as mensagens, publica no tempo real e trata o
   desfecho. A linha escolhida volta como `list_reply.id` = `bot:<no>:<opção>`,
   o mesmo payload dos botões.
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

## Métricas por bloco

O motor devolve, em cada passo, os blocos **alcançados** (`entered`) e os que o
contato **deixou** (`exited`: bloco seguinte, resposta válida ou a saída
“inválida” desenhada). `runStep` soma isso por dia em
`WhatsAppChatbotNodeStat` (`chatbotId` + `nodeId` + dia UTC), com falha só em
log. `GET .../chatbots/{id}/stats` devolve os totais dos últimos 30 dias e o
editor desenha “N entradas · M saídas” em cada bloco. Entradas menos saídas é onde
a conversa ficou (passou a uma pessoa, desistiu, expirou). O job de retenção
`cleanup-chatbot-node-stats` apaga dias com mais de 60. Os números seguem o
`nodeId`: ao apagar e recriar um bloco, ele começa do zero.

## Alertas de “conversa aguardando”

Enquanto uma sessão está `RUNNING`, a conversa **não está aguardando**: o webhook
`communication.conversation.waiting` e o aviso à fila da equipe saem do
`WhatsAppWebhookService` só depois do `claimInbound` e apenas se nenhum bot
assumiu a mensagem, e o lembrete de conversa sem atendente
(`listUnattendedForReminder`) ignora conversas com sessão `RUNNING`. Quando o bot
passa para a fila sem distribuir a um atendente, `handoffToHuman` dispara o
evento (`returned_to_queue`) e avisa os membros da equipe.

## Salvamento automático

O editor salva o rascunho dois segundos após a última alteração
(`useChatbotAutosave`): sem permissão, com fluxo que o schema rejeita ou com
outro salvamento em andamento ele não roda, e um rascunho que falhou só é
tentado de novo depois de mudar. O indicador sob o nome mostra salvo / não
salvo / salvando / falhou. Não publica nada.

## API

`/api/workspaces/{id}/whatsapp/chatbots[...]`: CRUD, `publish`, `validate`,
`status`, `simulate`, `sessions`, `stats` (ver OpenAPI). Leitura para membros do módulo;
escrita para dono e administradores. Eventos auditados: `whatsapp_chatbot`
(`create`, `update`, `publish`, `activate`, `pause`, `delete`) e
`whatsapp_chatbot_session` (`finish`).

## Limitações conhecidas

- Sem mídia nos menus; a lista interativa existe só na API oficial da Meta.
- Sem teste A/B de fluxos. As métricas por bloco contam passagens, não pessoas, e
  não separam versões publicadas.
- Cabeçalhos e segredos nas integrações continuam fora, por decisão de
  segurança (o rascunho é legível por todo membro do módulo).
