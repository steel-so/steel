# Pix dentro da conversa (Z1)

Cobrança Pix enviada no WhatsApp pelo atendente ou pela IA, com a baixa do
pagamento na conversa e na oportunidade do CRM. Decisão de arquitetura:
[ADR 0056](./adr/0056-pix-na-conversa-atras-de-uma-interface-de-psp.md).
Manual do usuário: `content/docs/comunicacao/pix.mdx`.

## Estado atual

O PSP escolhido é o **AbacatePay** (decisão do dono do produto), mas o provedor
padrão continua `mock` e o recurso segue desligado por workspace até alguém
configurar. Tudo passa pela interface `PixProvider`
(`src/lib/pix/provider.ts`) e só existe o provedor `mock`
(`src/lib/pix/mock-provider.ts`): gera um BR Code válido (CRC16 conferido),
não chama rede e só reconhece pagamento pelo webhook assinado ou pela ação
"Simular pagamento". O recurso vem **desligado** por workspace
(`WhatsAppPixSettings.enabled = false`).

## Fluxo

1. `POST /workspaces/{id}/whatsapp/conversations/{conversationId}/pix` (ou a
   ação `SEND_PIX` de uma campanha de IA) chama
   `WhatsAppPixService.createCharge` / `createChargeForAi`.
2. O serviço cria a cobrança no provedor (`createCharge`), grava
   `WhatsAppPixCharge` (`PENDING`) e envia **duas mensagens** pela conexão da
   conversa: o resumo e o código copia e cola sozinho. Se as mensagens não
   saem, a cobrança é cancelada no provedor e no banco.
3. O PSP avisa o pagamento em
   `POST /api/whatsapp/webhook/pix/{provider}` (pública; o próprio provedor
   autentica). `WhatsAppPixService.handlePayment`:
   - marca `PAID` com `updateMany ... where status != PAID` (idempotente);
   - cria o evento `PIX_PAID` (fonte `PIX`) na linha do tempo da conversa;
   - anota a oportunidade (`CrmNote` "Pix recebido") quando a cobrança tem
     `opportunityId`;
   - publica `pix-charge.updated` no SSE (`/api/whatsapp/events`), filtrado
     pela visibilidade da conversa (Equipes).
4. `EXPIRED` não é gravado: é derivado de `expiresAt` na leitura
   (`effectivePixStatus`). Um pagamento que chega depois do vencimento ou do
   cancelamento ainda dá baixa.

## Trocar o provedor (quando o PSP for escolhido)

1. Implemente `PixProvider` (`createCharge`, `cancelCharge`, `parseWebhook`)
   num arquivo novo em `src/lib/pix/`.
2. Registre-o em `src/lib/pix/registry.ts` e acrescente o id em
   `PIX_PROVIDER` (`lib/env/_server.ts`) e em `.env.example`.
3. `parseWebhook` recebe os headers e o corpo **cru**: valide a assinatura do
   PSP ali e devolva os pagamentos como `PixPaymentNotification`.
4. `isTest` deve ser `false`: isso esconde "Simular pagamento".
5. Cobranças antigas continuam apontando para o provedor que as emitiu
   (`WhatsAppPixCharge.provider`), então trocar `PIX_PROVIDER` não afeta o
   cancelamento nem o webhook das que já existem.

## AbacatePay (`PIX_PROVIDER=abacatepay`)

Implementado em `src/lib/pix/abacatepay-provider.ts`, sobre o cliente de
`lib/abacatepay.ts` (mesma chave `ABACATE_PAY`; chave `abc_dev_` emite cobranças
de sandbox).

- **Cobrar**: `POST /v2/transparents/create` (`method: PIX`), valor em
  centavos (mínimo R$ 1,00), `expiresIn` em segundos, `externalId` = nosso txid.
  O `id` (`pix_char_...`) vira `providerChargeId`.
- **Consultar**: `GET /v2/transparents/check?id=` (`getChargeStatus`, opcional
  na interface; o fluxo normal usa o webhook).
- **Cancelar**: a doc não tem rota de cancelamento; `cancelCharge` não faz
  nada e a cobrança vence no `expiresIn`.
- **Webhook**: cadastre no painel do AbacatePay a URL
  `https://<host>/api/whatsapp/webhook/pix/abacatepay?webhookSecret=<segredo>`
  com o evento `transparent.completed`. O segredo é o `PIX_WEBHOOK_SECRET` (a
  origem) e o header `X-Webhook-Signature` (HMAC-SHA256 base64 do corpo cru com
  a chave pública da doc) garante a integridade. Outros eventos são
  autenticados e ignorados.
- **Cliente HTTP**: `lib/abacatepay-transparent.ts` (API v2, módulo próprio;
  `lib/abacatepay.ts` segue só com a cobrança de assinaturas e já usa `/v2`).
- **A confirmar na homologação**: o formato exato de `data` em
  `transparent.completed` não está na doc pública; o parser aceita
  `data.transparent`, `data.checkout` ou `data` plano (`id`, `paidAmount` ou
  `amount` em centavos, `updatedAt`, `payerInformation.PIX.name`).

## Variáveis de ambiente

| Variável | Para quê |
| --- | --- |
| `PIX_PROVIDER` | Provedor das novas cobranças (`mock` ou `abacatepay`). |
| `ABACATE_PAY` | Chave de API do AbacatePay (compartilhada com a cobrança de assinaturas). |
| `BOLETO_PROVIDER` / `BOLETO_WEBHOOK_SECRET` | Provedor de boleto (`mock` ou `abacatepay`) e o `webhookSecret` (mín. 16 caracteres) da URL do webhook. |
| `PIX_WEBHOOK_SECRET` | No `abacatepay`, o `webhookSecret` da URL. No `mock`: segredo (mínimo 16 caracteres) do HMAC-SHA256 do webhook do `mock`, enviado em `x-pix-signature`. Sem ele o webhook recusa toda chamada. |

## Pontos de atenção

- **Permissões**: cobrar exige `conversations × CREATE` e a conversa visível;
  cancelar, `conversations × EDIT`; ligar/desligar e simular, OWNER/ADMIN;
  listar por oportunidade, `opportunities × VIEW` no CRM.
- **IA**: a ação `SEND_PIX` fixa valor e descrição (ADR 0045: a IA só decide
  *se* age). Não passa pelas travas do atendente (IA atendendo, horário de
  atendimento), porque é a própria IA que conduz a conversa.
- **Auditoria**: `whatsapp_pix_charge` (`send`, `cancel`, `confirm`, `test`) e
  `whatsapp_pix_settings` (`update`).
- **Fora do escopo desta entrega**: confirmação automática ao cliente
  ("recebemos seu Pix"), aviso no inbox ao atendente, reembolso/estorno e
  conciliação. Dependem do PSP escolhido.

## Boleto (AbacatePay API v2)

Mesma ideia do Pix, atrás de `BoletoProvider` (`src/lib/boleto/`): `mock`
(padrão) e `abacatepay` (`POST /v2/transparents/create` com `method: BOLETO`;
exige nome e CPF/CNPJ do pagador, vencimento opcional de até 365 dias, juros e
multa opcionais). `BOLETO_PROVIDER` escolhe o provedor e
`BOLETO_WEBHOOK_SECRET` é o `webhookSecret` da URL
`https://<host>/api/boleto/webhook/abacatepay?webhookSecret=<segredo>`.

- Webhook: `transparent.completed` = pago, `transparent.refunded` = estornado,
  `transparent.expired` = vencido (a doc não lista esse evento; o vencimento
  também se lê por `getChargeStatus`, que vira `EXPIRED` após a data).
- Não há rota de cancelamento na doc.
- **Estado**: camada de provedor, rota de webhook (autentica, registra e
  confirma) e testes. Ainda **não há** tabela de cobranças de boleto, tela de
  cobrança na conversa (Z1) nem baixa em proposta (C6); entram numa entrega
  própria, desligadas por workspace até um admin ligar.
