# 0048 — SLA de primeira resposta e resolução no atendimento do WhatsApp

- **Status:** Aceita
- **Data:** 2026-10-22
- **Decisores:** product owner (delegação da onda de operação do zap, 22/10) + time de engenharia

## Contexto

O módulo Comunicação não mede quanto o time demora para responder nem para
resolver uma conversa. A comparação com as ofertas de atendimento do mercado
mostrou que quem opera filas (clínicas, varejo, provedores, cobrança,
suporte) pede um prazo configurável, aviso antes de estourar e um número no fim
do mês.

O ServiceDesk já tem um motor de SLA/OLA ([ADR 0008](./0008-servicedesk-itil4-module.md)),
mas ele é acoplado ao chamado (fases, pausas por estado, calendários de
negócio do chamado). Uma conversa de WhatsApp vive meses, é fechada e reaberta
pelo próprio contato e não tem fase nem prioridade. Reaproveitar o motor do
ServiceDesk forçaria a conversa a parecer um chamado.

Restrições que pesaram:

- **Seguro por padrão.** Muitos tipos de cliente; nenhum workspace muda de
  comportamento até um administrador ligar uma política.
- **Não falhar o fluxo de mensagens.** A medição roda dentro do webhook, do
  envio e do fechamento; um erro dela não pode derrubar nenhum deles.
- **Futuro protocolo por atendimento.** O slice `zap-protocol-plan`
  ([ADR 0049](./0049-whatsapp-conversation-protocol-plan.md)) planeja um número
  de protocolo por atendimento. O ciclo de SLA precisa ser a unidade a que ele
  se anexa, sem depender dele.
- **Horário de atendimento já existe** (`WhatsAppSettings.businessHours*`,
  `src/lib/whatsapp/business-hours.ts`). Não se reimplementa.

## Decisão

Um **ciclo de SLA** explícito por atendimento, uma **política** por workspace
(com exceção por equipe) e um **tick de um minuto** no worker que avisa uma vez
e marca o estouro.

### Ciclo (`whatsapp_sla_cycles`)

- Começa na mensagem do contato numa conversa **sem ciclo aberto** (conversa
  nova ou recém-reaberta) e termina no **fechamento**. Uma conversa tem no
  máximo um ciclo aberto (índice único parcial em `resolved_at IS NULL`); a
  corrida entre duas mensagens simultâneas vira um `null` benigno.
- Guarda `startedAt`, `firstResponseAt`, `resolvedAt`, os instantes de prazo e
  de aviso (`firstResponseDueAt/WarnAt`, `resolutionDueAt/WarnAt`), as marcas
  idempotentes (`*WarnedAt`, `*BreachedAt`) e uma **cópia** da política usada
  (`policyId`, `teamId`, minutos, `businessHoursOnly`, `countAiAsResponse`). A
  tabela **não tem nenhum campo de protocolo**: um protocolo futuro aponta para
  o ciclo.
- Os prazos são **calculados uma vez**, no início, com o horário de atendimento
  aplicado (`src/lib/whatsapp/sla-time.ts`, sobre `business-hours.ts`). O tick
  vira uma consulta indexada, sem recalcular horário de ninguém.
- `WhatsAppConversation` ganha `firstInboundAt` e `firstResponseAt` (aditivos,
  desnormalizados a partir do ciclo); `closedAt` segue sendo o momento da
  resolução.

### Política (`whatsapp_sla_policies`)

- `teamId` nulo = padrão do workspace; um id = exceção da equipe, que vence a
  padrão. Uma por escopo (índice único parcial para o padrão).
- `enabled` (padrão `false`), `firstResponseMinutes`, `resolutionMinutes`
  (nulo = não medir), `businessHoursOnly` (padrão `true`, **sem efeito** enquanto
  o horário de atendimento do workspace estiver desligado: o relógio é 24 h),
  `warnAtPercent` (padrão 80), `countAiAsResponse` (padrão `false`),
  destinatários (responsável, líderes da equipe, supervisores — vazio = OWNER/ADMIN)
  e canais (no app e/ou e-mail).
- A política vale **no início do ciclo**: mudar a política não mexe nos ciclos
  abertos. Equipe do ciclo e política são as da **primeira mensagem**; uma
  conversa roteada para outra equipe depois continua com os prazos do começo
  (v1; ver "Fica de fora").

### Medição

- **Primeira resposta:** a primeira mensagem de saída de uma **pessoa** depois do
  início do ciclo — pelo Steel (`finalizeOutboundMessage`) ou digitada no
  celular conectado (Z-API `fromMe`). Respostas da IA não contam, salvo
  `countAiAsResponse`. O tempo gasto (`firstResponseSeconds`) é em horário útil
  quando o ciclo é `businessHoursOnly`.
- **Resolução:** o fechamento, por qualquer caminho (pessoa, inatividade,
  ação de botão, campanha de IA).
- **Sem pausa por "aguardando o cliente" na v1.** O relógio só para na primeira
  resposta (e, para a resolução, no fechamento). Pausar por estado exige um
  conceito de "bola com o cliente" que a conversa não tem; fica documentado e
  para uma próxima versão.

### Motor

- Job repetível `sla-tick` (todo minuto) na fila existente
  `whatsapp-conversation-lifecycle` (`WhatsAppSlaEngineService.scanDue`). Quatro
  passadas, sempre **estouro antes de aviso**: primeira resposta e resolução.
- Cada aviso sai **uma vez**: a marca é reservada por escrita condicional
  (`updateMany ... WHERE flag IS NULL`) **antes** de notificar, então dois
  workers não duplicam. Se a notificação falha depois da reserva, ela é
  registrada e não repetida (preferimos perder um aviso a duplicar).
- Aviso pelo `notifyWhatsAppUsers` com os tipos novos `WHATSAPP_SLA_AT_RISK` e
  `WHATSAPP_SLA_BREACHED`; por e-mail, o template `WhatsAppSlaAlert`. Ninguém é
  avisado de conversa que não pode ver (regra de Equipes). O estouro também grava
  o evento `SLA_BREACHED` (origem `SLA`) na linha do tempo e publica a conversa
  no tempo real.
- O ciclo de uma conversa fechada ou excluída que ficou aberto por falha é
  encerrado pelo próprio tick (autocura).
- Nenhum gancho falha o fluxo de origem: webhook, envio, resposta da IA e
  fechamento chamam `WhatsAppSlaService.onInbound/onOutbound/onClosed`, que
  registram o erro e seguem.

### Superfície

- Rotas em `/api/workspaces/{id}/whatsapp/sla/{policies,open,report}`;
  políticas só OWNER/ADMIN; `open` respeita a visibilidade de conversas;
  relatório só OWNER/ADMIN e líderes (que veem só as equipes que lideram).
- Indicador no cabeçalho da conversa e filtro "SLA em risco ou estourado" na
  lista (escondido enquanto não há ciclo aberto); seção de SLA em
  `zap/reports` (% no prazo, média e p90 da primeira resposta, estouros por
  atendente e equipe, CSV); política em `zap/configuracoes`.
- "Dentro do prazo" no relatório: o evento aconteceu até o prazo. Prazos ainda
  em andamento e ciclos fechados antes do prazo sem resposta **não são
  avaliados**. "Por atendente" usa o responsável guardado no ciclo no último
  marco (primeira resposta, estouro ou fechamento).

## Consequências

- Um workspace só passa a ter linhas em `whatsapp_sla_cycles` depois de
  ativar uma política; o custo para os demais é uma consulta por mensagem
  recebida/enviada (índice por conversa).
- A conversa "viva há meses" mede o **atendimento** (do primeiro contato ao
  fechamento), não cada pergunta do cliente: com o ciclo aberto, novas mensagens
  não abrem outro. Quem quer medir por demanda fecha a conversa (a inatividade
  já faz isso).
- A equipe e a política ficam as do começo do atendimento. Reavaliar quando a
  distribuição automática (ADR 0047) atribuir equipe depois da primeira mensagem
  com frequência: o caminho é recalcular os prazos do ciclo aberto na troca de
  equipe.
- Pausar enquanto se espera o cliente, SLA por canal/conexão e widget de
  dashboard ficam de fora da v1. O relatório cobre o que o dashboard mostraria.
- O protocolo por atendimento (ADR 0049) anexa-se a `whatsapp_sla_cycles.id`;
  nada neste ADR precisa mudar para isso.
