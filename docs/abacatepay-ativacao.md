# AbacatePay: ativar Pix, boleto e proposta (teste e produção)

Tudo do AbacatePay já está no código e **desligado**: `PIX_PROVIDER` e
`BOLETO_PROVIDER` valem `mock`, a cobrança de assinaturas fica atrás de
`BILLING_ENABLED` e cada workspace precisa ligar o Pix e o boleto nas
configurações. Este guia diz o que falta para sair do `mock`. Todas as chamadas
usam a **API v2** pelo cliente único `lib/abacatepay.ts`.

## O que existe

| Fluxo | Onde | Webhook |
| --- | --- | --- |
| Pix na conversa (Z1) | `src/lib/pix/`, `WhatsAppPixService` | `POST /api/whatsapp/webhook/pix/abacatepay` |
| Boleto na conversa (Z1) | `src/lib/boleto/`, `WhatsAppBoletoService` | `POST /api/boleto/webhook/abacatepay` |
| Pix/boleto na proposta (C6) | `CrmProposalPaymentService` | o mesmo webhook de Pix e de boleto |
| Assinatura do plano | `lib/abacatepay.ts` | `POST /api/payment/webhook` |

A baixa é idempotente, o webhook confere o segredo da URL e a assinatura
`X-Webhook-Signature` (HMAC-SHA256 em base64 do corpo cru), e avisos de
cobranças desconhecidas são confirmados sem efeito.

## Modo de teste (token `abc_dev_...`)

O AbacatePay decide o ambiente pela **chave**: uma chave de desenvolvimento
cria cobranças de sandbox (`devMode: true` na resposta) na mesma URL
`https://api.abacatepay.com/v2`. Não há mudança de código nem URL à parte.

1. No painel do AbacatePay, ative o **modo de desenvolvimento** e copie a chave
   de API dele (**confirme na tela**). Entregue-a pelo canal combinado (SOPS ou
   GitHub Secret), nunca no chat.
2. No ambiente de **homologação** (`secrets/homologacao.enc.env`), defina:
   - `ABACATE_PAY=<chave de desenvolvimento>`
   - `PIX_PROVIDER=abacatepay` e `BOLETO_PROVIDER=abacatepay`
   - `PIX_WEBHOOK_SECRET` e `BOLETO_WEBHOOK_SECRET`: textos aleatórios de pelo
     menos 16 caracteres (por exemplo `openssl rand -hex 24`), um para cada.
3. No painel do AbacatePay (modo de desenvolvimento), cadastre dois webhooks:
   - `https://<host>/api/whatsapp/webhook/pix/abacatepay?webhookSecret=<PIX_WEBHOOK_SECRET>`
     com o evento `transparent.completed`;
   - `https://<host>/api/boleto/webhook/abacatepay?webhookSecret=<BOLETO_WEBHOOK_SECRET>`
     com `transparent.completed` e `transparent.refunded` (e `transparent.expired`,
     se o painel oferecer).
4. Faça o deploy da homologação. Em **WhatsApp › Configurações › Atendimento**,
   ligue **Cobrar via Pix na conversa** e **Enviar boleto na conversa**. O aviso
   "provedor de teste" some, porque o provedor agora é o real (de sandbox).
5. Teste: envie um Pix e um boleto numa conversa (e, no CRM, cobrança numa
   proposta). Pague pelo recurso de simulação do painel do AbacatePay (**confirme
   na tela**) e confira que o card vira **Pago**, a conversa mostra o aviso e a
   oportunidade recebe a anotação. Repita o envio do mesmo aviso (reenvio no
   painel): nada deve duplicar.

O valor mínimo de uma cobrança é R$ 1,00. O vencimento do boleto vai de 1 a 90
dias (a API aceita até 365).

## Produção (falta só a chave de produção)

Nada no código muda. Quando a chave de produção chegar:

1. Troque `ABACATE_PAY` em `secrets/production.enc.env` (esse arquivo ainda não
   existe; crie-o antes da primeira promoção) e repita os segredos de webhook.
2. Cadastre os mesmos webhooks no painel em modo de **produção**, com o host
   de produção.
3. Cada workspace liga o Pix e o boleto por conta própria. Só então as cobranças
   movimentam dinheiro de verdade. `BILLING_ENABLED` (assinaturas) é uma decisão
   à parte e continua `false` até o dono mandar.
4. Para voltar atrás, ponha `PIX_PROVIDER=mock` e `BOLETO_PROVIDER=mock`: as
   cobranças já emitidas continuam apontando para o provedor que as criou.

## Pontos a confirmar na homologação

- O formato exato de `data` nos eventos `transparent.*` não está na doc
  pública; o parser aceita `data.transparent`, `data.checkout` ou `data` plano.
- A doc não lista cancelamento nem o evento de vencimento do boleto: o
  cancelamento fecha só no Steel, e o vencimento é derivado da data.
