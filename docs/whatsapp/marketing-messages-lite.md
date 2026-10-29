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

`GET /api/workspaces/{id}/whatsapp/broadcasts/{broadcastId}/marketing-metrics` devolve o número de destinatários enviados pela Lite e, via `template_analytics` da Meta, enviados/entregues/lidos/cliques do template desde o primeiro envio da lista. Os totais são do **template**, não da lista: a Meta não separa por lista. O id do template na Meta não é guardado, então é buscado por nome e idioma em `message_templates`. Falha da Meta não derruba a chamada: os contadores voltam e `analytics` fica nulo com o motivo.

## Decisões

- Interruptor por workspace, desligado por padrão: o aceite dos termos de marketing é por conta Meta (gate de terceiros).
- Só transmissões usam a Lite. Campanhas de IA, campanhas do CRM e respostas de atendente continuam em `/messages`.
- Custo: o registro de custo (`WhatsAppCostService`) continua tratando o envio como `TEMPLATE`; a diferença de preço da Lite ainda não está na tabela de tarifas.
