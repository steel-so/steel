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

## Decisões

- Só conexões Meta: Flow é recurso da Cloud API.
- O formulário do CRM é copiado (não referenciado): editar um não mexe no outro,
  e os limites da Meta (rótulos curtos) pedem ajuste de qualquer jeito.
- Publicar de novo cria outro Flow na Meta em vez de tentar editar o publicado
  (a Meta não deixa); o antigo fica de pé para quem ainda não respondeu.
- Excluir só antes do primeiro envio; depois, descontinuar (preserva as
  respostas, dado pessoal sob a LGPD).
- Não há endpoint de dados (Flow dinâmico, `data_exchange`) nesta versão: todas
  as telas são estáticas. Também ficam fora: disparo em massa de Flows pelas
  transmissões e um nó "enviar formulário" no chatbot.
- Aprovação do app pela Meta para Flows na produção não bloqueia o código: sem
  ela, a publicação devolve a recusa da Meta no editor.
