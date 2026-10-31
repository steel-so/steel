# Ferramentas de negócio do CRM (C6, C8, C9)

Três recursos do CRM para depois que a proposta sai. Tudo vive na migração `nov_crm_deals` e na fila `crm-deals`.

## C6 · Assinatura digital e cobrança na proposta

- **Assinatura:** a página pública `/p/<shareToken>` mostra o quadro de assinatura (o mesmo `SdSignaturePad` do ServiceDesk) quando `proposalSignatureEnabled`. `POST /api/crm/proposals/{shareToken}/sign` decodifica o PNG, grava em MinIO (`crm-proposals/<ws>/<proposta>/signatures/<id>.png`), aceita a proposta pelo mesmo caminho do aceite por nome e guarda o SHA-256 do PNG e do snapshot canônico da proposta (`src/lib/crm-deals/snapshot.ts`) e o hash do IP. Com a chave ligada, o aceite só pelo nome responde `CRM_PROPOSAL_SIGNATURE_REQUIRED` (a regra está em `CrmProposalPaymentService.accept`, que a rota `/accept` usa).
- **Cobrança:** `CrmProposalCharge` (Pix ou boleto), criada pelo provedor ativo da interface `PixProvider` (Z1, `src/lib/pix`). Só existe o provedor `mock`; o boleto de teste é uma linha digitável falsa (banco `999`, sem dígitos verificadores reais). **Desligada por padrão** (`proposalPaymentEnabled`); sem PSP real, nada move dinheiro.
- **Pagamento:** o webhook público `POST /api/crm/payments/webhook/{provider}` (assinatura HMAC do provedor) ou `Simular pagamento` (admin, só provedor de teste) chama `CrmProposalPaymentService.handlePayment`, idempotente: marca a cobrança `PAID`, move a oportunidade para a primeira etapa `WON` do pipeline (`wonAt`, webhooks de saída), registra uma nota e notifica o responsável (`CRM_PROPOSAL_PAID`). Falha ao ganhar o negócio nunca desfaz o pagamento: é registrada em log.
- **Status expirado** é calculado na leitura (`PENDING` com `expiresAt` vencido), sem job.

## C8 · Sala de negociação compartilhada

- `CrmDealRoom` (uma por oportunidade, token opaco), com materiais (links), plano de ação (`SELLER`/`CUSTOMER`), visitantes (nome + e-mail, IP só em hash), eventos (`ROOM_OPENED`, `PROPOSAL_VIEWED`, `MATERIAL_OPENED`, `ACTION_COMPLETED`, `MESSAGE_SENT`) e mensagens.
- Página pública `/sala/<token>`; API pública em `/api/crm/deal-rooms/{token}` (leitura, `visitors`, `events`, `messages`, `actions/{id}`), com limite por IP. O cliente só marca as ações dele.
- Staff: `GET/PUT /api/workspaces/{id}/crm/opportunities/{oid}/room` e `.../room/messages`. `PUT` substitui materiais e ações por id; `rotateToken` invalida o link.
- A identificação do visitante é apenas para rastreio: o token já dá acesso ao conteúdo.

## C9 · Pós-venda: renovações e expansão

- `CrmContract` (empresa, valor, início/fim, renova sozinho, status). Fila `crm-deals`, job `renewal-scan` diário às 06:30 (`CrmDealsCron`), por workspace com o CRM ligado: avisa o responsável uma vez (`alertedAt`, `CRM_CONTRACT_EXPIRING`), cria a oportunidade de renovação (`renewalOpportunityId`, mesmo pipeline da venda ou o padrão, primeira etapa `OPEN`), avança contratos que renovam sozinhos e encerra os vencidos. Idempotente.
- Janela e criação automática em `CrmDealsSettings` (`renewalLeadDays`, `renewalAutoCreate`).
- **Expansão:** `GET /api/workspaces/{id}/crm/companies/{companyId}/upsell` ranqueia produtos comprados por clientes que já têm o que esta conta tem (`computePeerAdoption`) e dá o momento (`upsellTiming`): usa a última pesquisa respondida (T1; ligada à empresa pelo e-mail ou telefone das pessoas) e o nível de saúde do cliente (T4). Risco alto ou nota baixa = `WAIT`.

## Interface

| Tela | Arquivo |
| --- | --- |
| Gaveta de cobrança e assinatura da proposta | `app/_components/crm/deals/proposal-checkout-drawer.tsx` |
| Pagamento na página pública da proposta | `app/_components/crm/deals/proposal-payment-panel.tsx` |
| Bloco da sala na oportunidade | `app/_components/crm/deals/deal-room-panel.tsx` |
| Sala pública | `app/(public)/sala/[token]/page.tsx` e `app/_components/crm/deals/public/deal-room-view.tsx` |
| Renovações | `app/(private)/[workspace-slug]/crm/renewals/page.tsx` |
| Chaves | `app/_components/settings/crm-deals-settings-section.tsx` |

## Fora do escopo desta entrega

PSP real (Pix/boleto de verdade), conciliação, estorno e nota fiscal; envio do link da sala por e-mail ou WhatsApp; anexos enviados direto na sala (hoje só links); edição das contas de contrato por importação CSV.
