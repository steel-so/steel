# 0073 — Ação de botão "Enviar outro template"

- **Status:** Aceita
- **Data:** 2026-11-27
- **Decisores:** product owner (Stratus Telecom), pedido da Fidelizza+

## Contexto

Os botões de resposta de templates e respostas rápidas já disparam ações no
clique (responder, atribuir, mudar status, workflow, webhook, instrução à IA).
Faltava encadear templates: o contato clica em "Quero a segunda via" e recebe
outro template aprovado.

## Decisão

Nova ação `SEND_TEMPLATE` (`{ kind, templateId }`), executada pelo worker de
ações de botão (`runSendTemplate`, `whatsapp-button-action.service.ts`).

- **Validação ao salvar** (`WhatsAppButtonSendTemplateGuard`, usada ao editar as
  ações do template, ao criar um template e ao salvar uma resposta rápida): o
  template existe no workspace, está `APPROVED`, **não tem variáveis** (`{{n}}`;
  o clique não tem como preenchê-las) e é **da mesma conexão** do template que
  carrega o botão. Em resposta rápida, que não pertence a uma conexão, a
  conexão só é conferida no clique. O mesmo teste roda de novo no clique, porque
  o template pode ter sido pausado ou apagado depois.
- **Laço:** salvar é recusado quando o template alcança a si mesmo por uma
  cadeia de `SEND_TEMPLATE` (A→A, A→B→A, A→B→C→A; busca com limite de 20
  níveis). O grafo fica sem ciclos. Além disso, cada passo da cadeia exige um
  novo clique do contato, então não existe repetição sem ninguém.
- **Portões de envio:** o envio passa pelo portão de qualidade
  (`assertCampaignSendAllowed`, remetente `BUTTON`: número ou template
  vermelho bloqueia, ADR 0070) e por `WhatsAppSend.template`, que já aplica o
  bloqueio de contato, o limite do plano e o **teto de gasto por número**
  (ADR 0064). Falha em qualquer um vira resultado de ação com falha (log e
  próximas ações seguem), nada é gravado.
- **Sem usuário:** como `REPLY`, a mensagem é gravada sem remetente e não fecha
  o relógio de SLA de primeira resposta (esse caminho, `finalizeOutboundMessage`,
  exige um atendente). O corpo e os botões da mensagem saem de
  `templateSentText` e `applyTemplateSendExtras`, então os botões do template
  enviado também funcionam no clique seguinte.

## Consequências

- Só templates sem variáveis podem ser alvo; suportar variáveis exigiria
  mapear dados do contato (decisão futura).
- Um template alvo que depois ganhe um botão apontando para o primeiro é
  recusado no salvamento desse segundo template (a busca olha o grafo inteiro).
