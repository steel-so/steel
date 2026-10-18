# 0036 — Webhooks de saída

- **Status:** Aceita
- **Data:** 2026-10-18
- **Decisores:** product owner + time de engenharia

## Contexto

O Steel recebe webhooks de vários sistemas, mas não avisa sistemas externos
quando algo acontece nele (`content/dev/webhooks.mdx`: "Hoje o Steel não envia
webhooks para URLs suas"). O que sai hoje são avisos no Slack, configurados
por evento em Ajustes › Integrações a partir do catálogo
`src/lib/integrations/catalog.ts`. O `steel listen` do CLI precisa de eventos
para escutar.

## Decisão

**O workspace cadastra endpoints HTTPS que recebem eventos assinados com
HMAC-SHA256, entregues por uma fila BullMQ, a partir de um catálogo de
eventos versionado.**

Detalhes para aplicar:

- **Catálogo:** `src/lib/webhooks/events.ts`, eventos com nome estável
  (`servicedesk.ticket.created`, `servicedesk.ticket.updated`,
  `crm.lead.created`, `crm.opportunity.stage_changed`, `crm.deal.won`,
  `communication.message.received`…), cada um com módulo, descrição pt-BR e o
  schema Zod do `data`. Reaproveita os pontos onde o catálogo de integrações
  já dispara os avisos do Slack.
- **Endpoint (`WebhookEndpoint`):** workspace, URL HTTPS, eventos assinados,
  segredo (cifrado com `CONNECTION_SECRETS`), ativo, criado por. OWNER/ADMIN
  gerenciam em Ajustes › Integrações › **Webhooks**.
- **Entrega:** fila `webhooks-delivery` no worker. Corpo
  `{ id, type, createdAt, workspaceId, data }`; cabeçalhos
  `Steel-Webhook-Id`, `Steel-Webhook-Timestamp`, `Steel-Signature`
  (`v1=<hmac de "timestamp.corpo">`). Até 6 tentativas com backoff
  exponencial; 2xx confirma; endpoint com falhas seguidas por 3 dias é
  desativado e o admin é avisado.
- **Log de entrega (`WebhookDelivery`):** status, código, duração, tentativa,
  retenção de 30 dias, reenvio manual pela tela.
- **Escuta para o CLI:** `GET /api/v1/webhooks/listen` (SSE, token pessoal)
  repassa os eventos do workspace em tempo real, com a mesma assinatura, pelo
  Redis pub/sub (como `src/lib/whatsapp/realtime.ts`).
- **SSRF:** a URL não pode resolver para IP privado, loopback ou link-local.

## Consequências

- O Steel passa a avisar ERPs, BI e automações dos clientes sem polling.
- O catálogo de eventos vira contrato público: mudar o `data` de um evento
  segue a mesma regra de estabilidade da API v1 (ADR 0035).
- Mais uma fila no worker e mais uma tabela com retenção.
