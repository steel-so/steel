# Marketing Messages Lite (Z11)

Envio de templates de marketing pela API `POST /{phone-number-id}/marketing_messages` da Meta, em vez de `/messages`. Rótulo 2026.04.11.3.

## Quando ativa

Um destinatário de transmissão sai pela Lite quando **todas** estas condições valem no momento do envio (`WhatsAppBroadcastService.sendToRecipient`):

- a conexão é `META` (Z-API nunca);
- o template tem categoria `MARKETING`;
- `WhatsAppSettings.marketingLiteEnabled` está ligado (padrão **desligado**, em Transmissões, só OWNER/ADMIN).

O payload é o mesmo do template comum. Com `marketingLiteCloudFallback` (padrão ligado), vai também `product_policy: CLOUD_API_FALLBACK`, que deixa a Meta cair para a Cloud API quando a Lite não entrega.

O destinatário enviado pela Lite fica com `viaMarketingLite = true`.

## Métricas

`GET /api/workspaces/{id}/whatsapp/broadcasts/{broadcastId}/marketing-metrics` devolve o número de destinatários enviados pela Lite e, via `template_analytics` da Meta, enviados/entregues/lidos/cliques do template desde o primeiro envio da lista. Os totais são do **template**, não da lista: a Meta não separa por lista. O id do template na Meta não é guardado, então é buscado por nome e idioma em `message_templates`. Falha da Meta não derruba a chamada: os contadores voltam e `analytics` fica nulo com o motivo em pt-BR, escolhido pelo tipo do erro (`describeMarketingLiteError`): token expirado/revogado (190, 401), falta de permissão (10, 200-299, 403), limite de consultas (429, 4, 17, 32, 613, 80004), instabilidade da Meta (5xx), demora (cada chamada tem limite de 10 s) e template que a Meta não encontra mais (renomeado ou excluído — antes isso voltava zerado, o que enganava). A janela enviada à Meta é limitada aos 90 dias que `template_analytics` aceita e nunca termina no futuro; respostas com formato inesperado contam como zero em vez de quebrar. O teste com a API real é feito depois pelo dono.

## Decisões

- Interruptor por workspace, desligado por padrão: o aceite dos termos de marketing é por conta Meta (gate de terceiros).
- Só transmissões usam a Lite. Campanhas de IA, campanhas do CRM e respostas de atendente continuam em `/messages`.
- Custo: o envio continua registrado como `TEMPLATE` (categoria MARKETING) e o lançamento guarda `via_marketing_lite`. A tabela de preços (`whatsapp_prices`) tem a coluna opcional `lite_unit_price` (R$, por categoria e país, com a mesma vigência do preço comum; só faz sentido em MARKETING). `resolveUnitPrice(..., { lite: true })` usa esse valor quando existe e cai no preço comum quando está em branco, então o relatório de custos não muda até alguém preencher. Em Comunicação > Relatórios > Custos, a tabela ganhou a coluna "Marketing Lite" e o campo no formulário. Os valores são estimativas, como os demais: confira na fatura da Meta.
