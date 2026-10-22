# 0047 — Fila do WhatsApp: avisos de conversa sem atendente e distribuição automática

- **Status:** Aceita
- **Data:** 2026-10-22
- **Decisores:** product owner (autonomia da onda de operações do zap, 22/10) + time de engenharia

## Contexto

Na Comunicação, uma conversa nova que ninguém assumiu fica na **fila**. Dois
buracos apareceram na comparação com outras ofertas de atendimento:

1. `WhatsAppTeamService.notifyQueueOnInbound` só avisava quando a conversa tinha
   **equipe** e nenhum responsável. Uma conversa **sem equipe e sem atendente**
   não avisava ninguém, e nada lembrava de uma conversa esquecida na fila.
2. A fila era sempre **manual**: cada atendente escolhe o que assume. Em
   operações com volume (clínicas, varejo, provedores, cobrança, suporte) isso
   concentra o trabalho em quem é mais rápido e deixa conversa parada quando
   todos estão ocupados.

O produto atende muitos tipos de cliente, então tudo é **por workspace e seguro
por padrão**: nenhuma configuração nova muda o comportamento de um workspace
existente até um administrador ligá-la, salvo o aviso de fila sem equipe (que
corrige o buraco 1) e o lembrete de 10 minutos, ambos só notificações.

Peças reaproveitadas: equipes (`WhatsAppTeam*`), linha do tempo
(`WhatsAppConversationEvent`), notificações (`notifyWhatsAppUsers`), os
destinatários do alerta de sentimento, o horário de atendimento
(`src/lib/whatsapp/business-hours.ts`) e a fila `whatsapp-conversation-lifecycle`
do worker.

## Decisão

### A. Avisos de conversa sem atendente

- **Quem é supervisor.** A regra dos destinatários do alerta de sentimento
  (lista configurada em `sentimentAlertRecipientIds`, senão OWNER/ADMIN) foi
  extraída para `filterSupervisorRecipients` (`src/lib/whatsapp/supervisor-recipients.ts`)
  e passa a servir os dois alertas. Quem não enxerga a conversa pelas regras de
  Equipes nunca é avisado (o aviso carrega o nome do contato e um link).
- **Aviso imediato.** Conversa aberta, sem responsável, sem IA respondendo, não
  arquivada nem excluída avisa **uma vez por sequência de não lidas** (primeira
  mensagem não lida), como já era para equipes: a equipe, se houver; os
  supervisores quando **não há equipe** ou quando a distribuição não achou
  ninguém (`vazio`, `todos ausentes`, `todos no limite`, `fora do horário`).
- **Lembrete "ainda sem atendimento".** `WhatsAppSettings.unassignedReminderMinutes`
  (padrão **10**; 0 desliga). Passado o prazo, os supervisores e os **líderes da
  equipe** recebem **um** lembrete por *sequência sem responsável*.
  - O relógio é `WhatsAppConversation.queuedAt`, gravado por `queueEntry()`
    sempre que a conversa **entra** na fila sem responsável (criação, reabertura,
    devolvida à fila, equipe tirada de um agente, handoff da IA). O mesmo
    helper zera `unassignedReminderAt`, o que reinicia o ciclo do lembrete.
    Conversas antigas sem `queuedAt` usam `createdAt`.
  - Para não disparar uma rajada no deploy, só conversas com até **48 h** de fila
    recebem lembrete; cada tick envia no máximo 100 por grupo de regra.
  - A reserva do lembrete é uma escrita condicional
    (`claimUnassignedReminder`): dois ticks simultâneos não lembram duas vezes.
- **Canais.** `unassignedAlertNotifyInApp` (padrão ligado) e
  `unassignedAlertNotifyEmail` (padrão desligado), como no alerta de sentimento.
  Novo tipo de notificação `WHATSAPP_CONVERSATION_UNATTENDED`.
- **Tick.** Um job repetível `distribution-tick` (a cada minuto) na fila
  existente `whatsapp-conversation-lifecycle` — acréscimo em vez de fila nova, já
  com worker, retry e agendador. Ele distribui as filas dos workspaces que ligaram
  a distribuição e depois envia os lembretes. Workspaces sem linha de
  configuração usam os padrões; as consultas são agrupadas por valor de
  `unassignedReminderMinutes`, então o corte de tempo é exato por workspace.

### B. Distribuição automática

Configuração em `WhatsAppSettings` (campos aditivos):
`distributionMode` (`OFF` | `ROUND_ROBIN` | `LEAST_LOADED`, padrão `OFF`),
`distributionMaxOpenPerAgent` (nulo = sem limite),
`distributionOnlyAvailable` (padrão ligado),
`distributionRespectBusinessHours` (padrão ligado). Só OWNER/ADMIN alteram, pela
rota de configurações que já existia.

- **Presença.** Novo modelo `WhatsAppAgentPresence` (`workspaceId`, `userId`,
  `status` `AVAILABLE` | `AWAY`, `lastAssignedAt`; único por workspace+usuário).
  Sem linha vale **Disponível**. O atendente troca num interruptor no menu lateral
  do WhatsApp; donos, administradores e líderes veem a situação na tela de
  equipes (um líder só vê as equipes que lidera). A troca é **manual**: marcar
  ausente por inatividade (heartbeat) ficou **fora do escopo** de propósito.
  Presença não vai por SSE: é consultiva, a tela da equipe consulta a cada 30 s,
  e o interruptor do próprio atendente atualiza na hora (otimista).
- **Quem entra no rodízio.** Conversa **com equipe**: os membros da equipe (agente
  e líder) que continuam membros do workspace e não são VIEWER; um administrador
  que está na equipe conta. Conversa **sem equipe**: os membros do workspace com
  papel **MEMBER**. Donos e administradores supervisionam a fila e ficam de fora,
  a menos que sejam da equipe; VIEWER nunca recebe.
- **Algoritmos** (função pura `pickAssignee`, `src/lib/whatsapp/distribution-picker.ts`):
  - `ROUND_ROBIN`: ordem estável por id; o próximo elegível depois do ponteiro,
    com volta ao início. O ponteiro fica na equipe
    (`WhatsAppTeam.distributionLastAssignedUserId`) ou, sem equipe, em
    `WhatsAppSettings.distributionLastAssignedUserId`. Quem saiu do grupo ou foi
    pulado apenas faz o ponteiro seguir adiante.
  - `LEAST_LOADED`: menos conversas abertas (não fechadas, arquivadas ou
    excluídas, de qualquer equipe); empate pelo `lastAssignedAt` mais antigo
    (nunca recebeu = mais antigo) e depois pelo id.
  - Os dois pulam ausentes (com `distributionOnlyAvailable`) e quem já está no
    limite. Sem ninguém elegível a conversa **continua na fila** e os
    supervisores são avisados (parte A).
- **Atomicidade.** A escolha e a gravação rodam dentro de um **lock consultivo do
  Postgres** por workspace (`pg_advisory_xact_lock`), então duas mensagens
  simultâneas veem o ponteiro e as cargas uma da outra e não escolhem o mesmo
  atendente por azar. A gravação da atribuição é condicional
  (`claimForAssignment`: sem responsável, aberta, sem IA, não arquivada), então a
  **atribuição manual sempre vence** e nunca é desfeita; se perder a corrida, o
  ponteiro não anda. Escolhemos o lock do banco em vez do Redis porque a base já
  é o árbitro das mesmas linhas e vale entre réplicas ([ADR 0038](./0038-app-replicas-behind-nginx-upstream.md)).
- **Gatilhos.** (1) mensagem recebida em conversa sem responsável e sem IA —
  conversa nova, reaberta ou qualquer mensagem enquanto espera, o que também
  tenta de novo se antes não havia ninguém; (2) botão que manda a conversa para
  uma equipe; (3) reabertura manual sem responsável; (4) a IA transfere para
  humano (a distribuição acontece no handoff, nunca enquanto a IA responde);
  (5) atendente volta a Disponível; (6) o tick de 1 minuto, que também libera a
  fila retida pelo horário de atendimento ou por atendentes cheios. Lotes
  limitados a 25 conversas, mais antigas primeiro.
- **Registro.** Cada atribuição grava `WhatsAppConversationEvent` `ASSIGNED` com
  origem nova `DISTRIBUTION`, é auditada (`actor: system`), publicada por SSE e
  notificada ao atendente. A linha do tempo mostra "pela distribuição automática".

## Consequências

- Operações com volume podem dividir a fila sem coordenação humana, e nenhuma
  conversa fica esquecida sem alguém ser avisado. Workspaces que não mexerem em
  nada só ganham os avisos (nunca atribuição).
- Uma conversa **devolvida à fila** por um atendente volta a ser distribuída, e
  no modo "menos ocupado" pode voltar para ele. Aceito: devolver é pedir nova
  distribuição. Quem quiser segurar a conversa deve atribuí-la a uma pessoa.
- A presença só muda por ação do atendente; quem esquece o interruptor em
  "Disponível" continua recebendo. Marcar ausência por inatividade pode virar
  uma ADR futura, com heartbeat do navegador.
- O tick roda a cada minuto, mas só consulta o banco para workspaces com a
  distribuição ligada e para conversas realmente sem responsável.
- Revisitar: pesos por atendente, distribuição por habilidade ou por carteira de
  contatos, e SLA de primeira resposta (ADR 0048) usando o mesmo `queuedAt`.
