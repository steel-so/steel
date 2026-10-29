# Anúncios Click-to-WhatsApp com atribuição (Z4)

Lê a origem do anúncio (bloco `referral` do webhook da Meta), marca a origem do
lead no CRM e mede conversas, leads, vendas e ROI por anúncio.

## Fluxo

1. `app/api/whatsapp/webhook/meta/route.ts` lê `message.referral` com
   `parseMetaReferral` (`src/lib/whatsapp/ad-referral.ts`) e o repassa em
   `InboundWhatsAppMessage.referral`. Bloco sem id, URL ou click id é ignorado.
2. `WhatsAppWebhookService.ingestInboundMessage` chama
   `WhatsAppAdAttributionService.onInboundReferral` depois de gravar a mensagem.
   A falha só gera log (`whatsapp.ad.attribution_failed`): a mensagem já foi
   salva e a Meta não deve reenviar o webhook por isso.
3. O service lê `WhatsAppAdSettings`. Com `enabled = false` (padrão) nada é
   gravado. Ligado, grava `WhatsAppAdReferral` (idempotente por
   `providerMessageId`).
4. Com `createLeads`, chama `CrmLeadService.intake` (canal `system`,
   `via: 'whatsapp_ad'`) com `channel = WhatsApp` e `source = <base> · <título>`
   (máx. 100 caracteres) e liga o referral ao lead (`leadId`).

## Decisões

- **Primeiro toque**: um lead só é ligado ao primeiro referral que o alcança. Se
  o intake reaproveita um lead aberto (mesmo telefone), o link só é gravado se
  nenhum referral já o possuir.
- **Sem telefone, sem lead**: contato identificado só por BSUID não gera lead.
- **Criador do lead**: `leadOwnerId`; sem ele, o primeiro OWNER/ADMIN do
  workspace. O responsável configurado só é aplicado quando as regras de
  roteamento não definiram um.
- **Gasto digitado**: a conta Meta Ads não é lida (depende da revisão de app da
  Meta). `WhatsAppAdSpend` guarda valor por anúncio e período; o relatório
  divide igualmente pelos dias do lançamento e soma os dias do intervalo.
- **Receita**: soma de `CrmLead.closedAmount` dos leads `closeResult = WON`
  ligados ao anúncio. Oportunidades sem lead ficam de fora.
- **Custo por lead/conversa e ROI** são nulos sem gasto (ausência de dado, não
  "grátis").
- Só conexões Meta: a Z-API não envia o anúncio de origem.

## Dados e rotas

Tabelas `whatsapp_ad_settings`, `whatsapp_ad_referrals`, `whatsapp_ad_spends`
(migração `nov_z4_ctwa_attribution`). Rotas em
`app/api/workspaces/[id]/whatsapp/ads/**` (relatório, CSV, configuração e gastos,
só OWNER/ADMIN) e `.../conversations/[conversationId]/ad-referral` (qualquer
membro que veja a conversa). UI: aba **Anúncios** em Comunicação › Relatórios e
faixa de origem na conversa. Manual: `content/docs/comunicacao/anuncios.mdx`.
