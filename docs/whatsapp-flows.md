# WhatsApp Flows (Z3)

Telas nativas da Meta (cadastro, agendamento, pesquisa) montadas no Steel,
publicadas na WABA e enviadas por mensagem interativa ou template. A resposta
fica no formulário, no contato e, se configurado, no CRM. Manual do usuário:
`content/docs/comunicacao/formularios-flows.mdx`. Código:
`src/lib/whatsapp/flows/*` (puro), `src/lib/whatsapp/meta-flows.ts` (Graph API),
`src/services/whatsapp-flow*.service.ts`, UI em `app/_components/whatsapp/flows/*`
e `zap/flows`.

## Modelo

- `whatsapp_flows`: nome, categoria da Meta, `status` (`DRAFT`, `PUBLISHED`,
  `DEPRECATED`), `definition` (o que o editor grava) e `published_definition`
  (cópia do que foi enviado à Meta, para o aviso de "alterações não enviadas"),
  `meta_flow_id` / `meta_status`, `publish_error`, texto e botão da mensagem,
  agradecimento, `crm_action` (`NONE`, `LEAD`, `PERSON`, `COMPANY`) e
  `source_crm_form_id` (só referência: o formulário do CRM é **copiado**, não
  ligado).
- `whatsapp_flow_responses`: um envio. `flow_token` único é o que a Meta devolve
  na resposta; guarda `answers`, os ids criados no CRM e `mapping_note` (por que
  o CRM não recebeu). Cascata por workspace e por contato (LGPD).
- A definição é `screens[].fields[]` (`FlowDefinitionSchema`). Cada campo tem
  `key`, `label`, `type`, `options`, `mapping` (`contact.name` ou
  `lead|person|company.<atributo>`, os mesmos atributos do formulário do CRM).
  Limites em `FLOW_LIMITS` (8 telas, 8 campos por tela, 30 no total, rótulo por
  tipo como na referência do Flow JSON).

## Conversão para o Flow JSON

`buildMetaFlowJson` (versão 7.2): cada tela vira uma `SingleColumnLayout` com um
`Form`. Tela intermediária termina em `navigate` e leva as respostas anteriores
no `payload`; a próxima declara esses valores em `data`. A última tela é
`terminal` + `success` e termina em `complete` com **todas** as respostas. Ids de
tela só aceitam letras (`SCREEN_A`, `SCREEN_B`...).

## Publicação (`WhatsAppFlowService.publish`)

1. Valida a definição e a ação do CRM (`flowCrmIssues`).
2. Sem `meta_flow_id`, ou com o Flow já `PUBLISHED` na Meta (imutável), cria um
   Flow novo (`POST /{waba}/flows` com `flow_json`). Senão, sobe o JSON no Flow
   rascunho (`POST /{flow}/assets`).
3. `publish: true` chama `POST /{flow}/publish`.
4. Recusa da Meta (`validation_errors` ou HTTP) grava `publish_error`, mantém o
   id do Flow recém-criado e devolve `WHATSAPP_FLOW_META_REJECTED` (422).

O Flow antigo **não** é descontinuado quando um novo assume: mensagens já
enviadas continuam abrindo o antigo, e a resposta cai no mesmo formulário porque
o token carrega o id local (`stlf.<flowId>.<nonce>`).

## Envio

`WhatsAppFlowService.send` → `WhatsAppMessageService.sendFlow`:

- **Interativo** (`type: interactive`, `flow`, `flow_message_version: 3`,
  `flow_action: navigate` na primeira tela): só dentro das 24 h. Flow ainda
  rascunho na Meta vai com `mode: draft` (teste).
- **Template**: `POST /{waba}/message_templates` com `BODY` + botão `FLOW`
  (`WhatsAppFlowService.createTemplate`); o envio leva o componente `button` /
  `sub_type: flow` com o `flow_token`.
- A conversa precisa estar na conexão dona do Flow (`WHATSAPP_FLOW_NOT_SENDABLE`
  senão). Conexões Z-API falham no `WhatsAppSend.flow` (o cliente Z-API não
  implementa `sendFlow`).
- Depois do envio grava a linha `SENT` com o token.

## Resposta (webhook)

`app/api/whatsapp/webhook/meta`: `interactive.type = nfm_reply` vira uma mensagem
`TEXT` ("[Formulário respondido]") com `flowResponseJson`. Em
`WhatsAppWebhookService.ingestInboundMessage` (só módulo Comunicação),
`WhatsAppFlowResponseService.handleInbound`:

1. Acha o envio por `flow_token`; sem ele, pelo envio `SENT` mais recente da
   conversa (template enviado pelo seletor comum); com token nosso mas sem linha,
   recria a partir do id embutido. Fora disso a mensagem segue o fluxo normal.
2. **Reivindica** a resposta (`UPDATE ... WHERE status = 'SENT'`): reentrega do
   webhook não duplica lead nem agradecimento.
3. Sanitiza (só chaves da definição, tamanhos limitados), mapeia para o contato
   (`name`) e para o CRM: lead pela porta única `CrmLeadService.intake`
   (`via: whatsapp_flow`, com validação, dedupe, score e roteamento), pessoa e
   empresa pelos repositórios. Sem módulo CRM, sem responsável ou com erro, a
   resposta fica só no WhatsApp e `mapping_note` explica.
4. Reescreve a mensagem da linha do tempo com o resumo e, depois que o webhook
   publicou o evento, envia o agradecimento (`afterPublish`).
5. Resposta tratada = IA, chatbot e botões ficam quietos para essa mensagem.

## Preenchimento a partir do contato

`src/lib/whatsapp/flows/prefill.ts`. Para Flows estáticos a Meta aceita dados
na primeira tela: `flow_action_payload.data` na mensagem interativa e
`flow_action_data` no botão FLOW de um template. O Flow JSON lê esses dados
com `init-value: ${data.<chave>}` nos campos de texto da **primeira tela**
(`text`, `email`, `phone`, `number`, `textarea`), e a tela declara os dados em
`data`. As telas seguintes continuam recebendo só as respostas anteriores.

- Nome: campo mapeado para `contact.name`, `lead.name` ou `person.name`
  (empresa não: o nome do contato não é o da empresa).
- Telefone: campo `phone` (mapeado para `phone` ou sem mapeamento), só quando o
  contato tem telefone real (não um BSUID).
- Os demais campos vão vazios: o `data` é sempre completo para todo
  `${data.x}` resolver. A Meta recusa `data` vazio, então ele só vai quando há
  algum campo preenchível.
- Vale para os três caminhos de envio (conversa, transmissão e chatbot). Um
  formulário publicado antes desta versão não declara `init-value`: o dado
  extra é ignorado e o formulário abre vazio até a próxima publicação.

## Transmissão em massa

Uma transmissão (`WhatsAppBroadcastService.sendToRecipient`) com um template
que tem botão FLOW envia, a cada destinatário, o componente `button` /
`sub_type: flow` com **um `flow_token` próprio** e o preenchimento. O Flow é
achado pelo `flow_id` do botão do template (`WhatsAppFlowRepository.findByMetaFlowId`);
se o Flow não é do Steel ou foi descontinuado, o template sai sem token e a
resposta cai no caminho de sempre (pelo envio mais recente da conversa). Depois
do envio, `WhatsAppFlowDispatchService.recordSent` grava a linha `SENT`, e a
resposta chega à aba Respostas do formulário como qualquer outra. Só conexões
Meta (Z-API nunca procura Flow). O custo segue a categoria do template
(UTILITY/MARKETING), inclusive a Marketing Messages Lite quando ligada.

## Nó "Enviar formulário" no chatbot

Bloco `send-form` do construtor (Z2): `flowId`, mensagem e texto do botão
opcionais (aceitam `{{variáveis}}`) e um texto de contingência. O motor só emite
a saída `form`; quem envia é `sendForm` em `whatsapp-chatbot-runtime.service.ts`,
via `WhatsAppFlowDispatchService.prepareInteractive` (mensagem interativa com o
preenchimento, dentro das 24 h da conversa em andamento) e `recordSent`. O bot
**segue para o próximo bloco sem esperar** a resposta, que entra pelo caminho
normal do `nfm_reply`. Publicar o bot exige formulário existente, publicado e
não descontinuado. Em runtime, formulário indisponível (linha Z-API, outra
conexão, descontinuado) envia o texto de contingência, se houver, e o fluxo
continua; falha do provedor sem contingência passa a conversa para a fila, como
qualquer envio que falha.

## Webhook `flows` (status)

`app/api/whatsapp/webhook/meta`: `field = flows` vai para
`WhatsAppFlowWebhookService.applyStatusChange`. `FLOW_STATUS_CHANGE` grava
`meta_status` (`PUBLISHED`, `DRAFT`, `DEPRECATED`, `BLOCKED`, `THROTTLED`);
`DEPRECATED` também descontinua o formulário e `BLOCKED`/`THROTTLED` preenchem
o aviso do editor (`publish_error`), que sai quando o status se recupera. Os
outros eventos são ignorados. O dono do app precisa assinar o campo: ver
[o runbook](./runbooks/whatsapp-flows-webhook.md).

## Decisões

- Só conexões Meta: Flow é recurso da Cloud API.
- O formulário do CRM é copiado (não referenciado): editar um não mexe no outro,
  e os limites da Meta (rótulos curtos) pedem ajuste de qualquer jeito.
- Publicar de novo cria outro Flow na Meta em vez de tentar editar o publicado
  (a Meta não deixa); o antigo fica de pé para quem ainda não respondeu.
- Excluir só antes do primeiro envio; depois, descontinuar (preserva as
  respostas, dado pessoal sob a LGPD).
- Não há endpoint de dados (Flow dinâmico, `data_exchange`, com criptografia)
  nesta versão: todas as telas são estáticas. O preenchimento do contato cobre
  o que um Flow estático permite.
- O nó do chatbot não espera a resposta do formulário: a resposta pode demorar
  e chega por um caminho próprio (o bot não reaproveita o estado de pergunta).
- A transmissão não tem tela própria para Flows: usa o template criado em
  "Criar template" do formulário, como qualquer outro template.
- Aprovação do app pela Meta para Flows na produção não bloqueia o código: sem
  ela, a publicação devolve a recusa da Meta no editor.
