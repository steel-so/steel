# 0060 — Remoção do Instagram e do Messenger da caixa do zap

- **Status:** Aceita
- **Data:** 2026-10-31
- **Decisores:** dono do produto

## Contexto

O [ADR 0058](./0058-canais-da-meta-na-caixa-do-zap.md) trouxe Instagram Direct,
Messenger e comentários de publicações para a caixa do zap, ao lado da
Coexistência do WhatsApp. Os canais sociais nunca chegaram a ser oferecidos: a
revisão do app na Meta (permissões avançadas) não aconteceu e a interface já
estava escondida até 2027.

## Decisão

Remover por completo o Instagram Direct e o Messenger (mensagens e comentários) da
caixa do zap: webhook `/api/whatsapp/webhook/meta-social`, conexão por Página,
resposta a comentários, telas, hooks, rotas, testes e documentação.

Fica como está: WhatsApp pela Cloud API da Meta, Embedded Signup, **Coexistência**
(Z6), Z-API, Marketing Messages Lite e Flows. O módulo de redes sociais do CRM
(publicação de posts) é outra funcionalidade e não muda.

No banco, a migração `remove_instagram_messenger_channels` apaga as conexões
`INSTAGRAM`/`MESSENGER` (com suas conversas e mensagens) e os contatos `ig:`/`fb:`,
remove a tabela `whatsapp_social_comments`, as colunas `channel`, `meta_page_id` e
`meta_instagram_account_id` de `whatsapp_connections`, as chaves de Instagram,
Messenger e comentários de `whatsapp_meta_channel_settings` e o enum
`WhatsAppChannel`. As conexões de WhatsApp não são tocadas.

## Consequências

- O ADR 0058 continua válido apenas na parte da Coexistência.
- A tabela `whatsapp_meta_channel_settings` guarda agora só a chave
  `coexistence_enabled`; o nome ficou para não mexer em dados do WhatsApp.
- Voltar a oferecer esses canais exige uma decisão nova e a revisão do app na Meta.
