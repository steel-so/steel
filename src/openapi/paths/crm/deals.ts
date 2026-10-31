import { z } from 'zod'
import {
  CreateCrmContractSchema,
  CreateCrmProposalChargeSchema,
  CreateDealRoomMessageSchema,
  IdentifyDealRoomVisitorSchema,
  ListCrmContractsQuerySchema,
  ListDealRoomMessagesQuerySchema,
  PostDealRoomMessageSchema,
  RecordDealRoomEventSchema,
  SignCrmProposalSchema,
  ToggleDealRoomActionSchema,
  UpdateCrmContractSchema,
  UpdateCrmDealsSettingsSchema,
  UpsertCrmDealRoomSchema,
} from '@/src/schemas/crm-deals.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmContractDTO,
  CrmDealRoomDTO,
  CrmDealsSettingsDTO,
  CrmProposalChargeDTO,
  CrmProposalCheckoutDTO,
  CrmProposalPublicCheckoutDTO,
  CrmRenewalScanResultDTO,
  CrmUpsellDTO,
  DealRoomMessageDTO,
  DealRoomVisitorSessionDTO,
  PublicDealRoomDTO,
} from '../../schemas/crm/deals'
import { CrmProposalPublicDTO } from '../../schemas/public'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
} from './shared'

/**
 * CRM · Ferramentas de negócio (nov: crm-deals): assinatura digital e
 * cobrança na proposta (C6), sala de negociação compartilhada (C8) e
 * pós-venda com renovações e expansão (C9).
 */

const BASE = '/workspaces/{id}/crm'
const PROPOSALS = ['CRM · Propostas'] as RouteConfig['tags']
const OPPORTUNITIES = ['CRM · Oportunidades'] as RouteConfig['tags']
const COMPANIES = ['CRM · Pessoas e empresas'] as RouteConfig['tags']
const PUBLIC_PROPOSALS = ['CRM público · Propostas'] as RouteConfig['tags']
const PUBLIC_ROOM = ['CRM público · Sala de negociação'] as RouteConfig['tags']

const BINARY = {
  envelope: false,
  schema: { type: 'string', format: 'binary' },
} as const

const PROPOSAL_ID = 'ID da proposta.'
const CHARGE_ID = 'ID da cobrança.'
const OPPORTUNITY_ID = 'ID da oportunidade.'
const CONTRACT_ID = 'ID do contrato.'
const TOKEN = 'Token do link da sala de negociação.'

const PAYMENT_DISABLED: ErrorEntry = {
  code: 'CRM_DEALS_PAYMENT_DISABLED',
  when: 'A cobrança na proposta está desligada no workspace',
}
const CHARGE_NOT_FOUND: ErrorEntry = {
  code: 'CRM_PROPOSAL_CHARGE_NOT_FOUND',
  when: 'Cobrança inexistente nesta proposta',
}
const CHARGE_INVALID: ErrorEntry = {
  code: 'CRM_PROPOSAL_CHARGE_INVALID',
  when: 'Proposta ainda não enviada, sem valor, cobrança que não está pendente ou provedor sem boleto',
}
const PROPOSAL_NOT_FOUND: ErrorEntry = {
  code: 'CRM_PROPOSAL_NOT_FOUND',
  when: 'Proposta inexistente ou ainda em rascunho',
}
const OPPORTUNITY_NOT_FOUND: ErrorEntry = {
  code: 'CRM_OPPORTUNITY_NOT_FOUND',
  when: 'Oportunidade inexistente no workspace',
}
const ROOM_NOT_FOUND: ErrorEntry = {
  code: 'CRM_DEAL_ROOM_NOT_FOUND',
  when: 'A oportunidade não tem sala, ou o link foi desligado ou trocado',
}
const ROOM_INVALID: ErrorEntry = {
  code: 'CRM_DEAL_ROOM_INVALID',
  when: 'Proposta de outra oportunidade, visitante não identificado, material ou ação que não é da sala',
}
const CONTRACT_NOT_FOUND: ErrorEntry = {
  code: 'CRM_CONTRACT_NOT_FOUND',
  when: 'Contrato inexistente no workspace',
}
const CONTRACT_INVALID: ErrorEntry = {
  code: 'CRM_CONTRACT_INVALID',
  when: 'Contrato que não está ativo, já renovado, ou pipeline sem etapa em aberto',
}

export const crmDealsRoutes: RouteConfig[] = [
  // ─── settings ────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/deals-settings`,
    tags: PROPOSALS,
    summary: 'Configurações de assinatura, cobrança e renovação',
    description: describe(
      'Chaves das ferramentas de negócio do workspace. A cobrança na proposta nasce desligada.',
      crmAccess(null),
    ),
    responses: {
      200: { description: 'Configurações.', schema: CrmDealsSettingsDTO },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'patch',
    path: `${BASE}/deals-settings`,
    tags: PROPOSALS,
    summary: 'Alterar as configurações de assinatura, cobrança e renovação',
    description: describe(
      'Liga ou desliga a cobrança Pix/boleto na proposta (só o provedor de teste existe), a assinatura digital no aceite e ajusta a janela de renovação.',
      crmAccess('privileged'),
    ),
    consent: true,
    body: {
      schema: UpdateCrmDealsSettingsSchema,
      example: { proposalPaymentEnabled: true, renewalLeadDays: 45 },
    },
    responses: {
      200: { description: 'Configurações salvas.', schema: CrmDealsSettingsDTO },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },

  // ─── C6 · seller side ────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/proposals/{proposalId}/checkout`,
    tags: PROPOSALS,
    summary: 'Cobranças e assinaturas da proposta',
    description: describe(
      'O que a tela da proposta mostra: as cobranças (a pendente vencida aparece como `EXPIRED`) e as assinaturas do cliente.',
      crmAccess('documents', 'VIEW'),
    ),
    params: { proposalId: PROPOSAL_ID },
    responses: {
      200: { description: 'Cobranças e assinaturas.', schema: CrmProposalCheckoutDTO },
    },
    errors: [...CRM_ERRORS, PROPOSAL_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/proposals/{proposalId}/charges`,
    tags: PROPOSALS,
    summary: 'Criar cobrança Pix ou boleto na proposta',
    description: describe(
      'Gera a cobrança pelo provedor ativo (hoje só o de teste, que não movimenta dinheiro). O valor padrão é o da oportunidade. Quando o pagamento chega, a cobrança fica `PAID` e a oportunidade vai para a primeira etapa de ganho do pipeline.',
      crmAccess('documents', 'EDIT'),
    ),
    consent: true,
    params: { proposalId: PROPOSAL_ID },
    body: {
      schema: CreateCrmProposalChargeSchema,
      example: { method: 'PIX', amount: 4500, expiresInDays: 7 },
    },
    responses: {
      201: { description: 'Cobrança criada.', schema: CrmProposalChargeDTO },
    },
    errors: [...CRM_ERRORS, PAYMENT_DISABLED, CHARGE_INVALID, PROPOSAL_NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${BASE}/proposals/{proposalId}/charges/{chargeId}`,
    tags: PROPOSALS,
    summary: 'Cancelar cobrança da proposta',
    description: describe(
      'Só uma cobrança que ainda aguarda pagamento pode ser cancelada.',
      crmAccess('documents', 'EDIT'),
    ),
    consent: true,
    params: { proposalId: PROPOSAL_ID, chargeId: CHARGE_ID },
    responses: {
      200: { description: 'Cobrança cancelada.', schema: CrmProposalChargeDTO },
    },
    errors: [...CRM_ERRORS, CHARGE_NOT_FOUND, CHARGE_INVALID],
  },
  {
    method: 'post',
    path: `${BASE}/proposals/{proposalId}/charges/{chargeId}/simulate`,
    tags: PROPOSALS,
    summary: 'Simular o pagamento de uma cobrança de teste',
    description: describe(
      'Só com provedor de teste: liquida a cobrança como se o cliente tivesse pago, para experimentar o fluxo inteiro (negócio ganho, nota e aviso).',
      crmAccess('privileged'),
    ),
    consent: true,
    params: { proposalId: PROPOSAL_ID, chargeId: CHARGE_ID },
    responses: {
      200: { description: 'Cobrança paga.', schema: CrmProposalChargeDTO },
    },
    errors: [
      ...CRM_PRIVILEGED_ERRORS,
      CHARGE_NOT_FOUND,
      { code: 'FORBIDDEN', when: 'O provedor da cobrança não é de teste' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/proposals/{proposalId}/signatures/{signatureId}/image`,
    tags: PROPOSALS,
    summary: 'Imagem da assinatura do cliente',
    description: describe(
      'PNG guardado em bucket privado.',
      crmAccess('documents', 'VIEW'),
    ),
    params: { proposalId: PROPOSAL_ID, signatureId: 'ID da assinatura.' },
    responses: {
      200: { description: 'PNG.', contentType: 'image/png', ...BINARY },
    },
    errors: [...CRM_ERRORS, 'CRM_PROPOSAL_SIGNATURE_NOT_FOUND'],
  },

  // ─── C6 · public ─────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/crm/proposals/{shareToken}/checkout',
    tags: PUBLIC_PROPOSALS,
    summary: 'Assinatura e pagamento da proposta compartilhada',
    description:
      'Sem sessão. Diz se a página pede assinatura, quem já assinou e as cobranças a pagar ou pagas (só com a cobrança ligada no workspace).',
    auth: 'public',
    rateLimit: 'ip',
    params: { shareToken: 'Token do link da proposta.' },
    responses: {
      200: { description: 'Estado.', schema: CrmProposalPublicCheckoutDTO },
    },
    errors: [PROPOSAL_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/crm/proposals/{shareToken}/sign',
    tags: PUBLIC_PROPOSALS,
    summary: 'Assinar e aceitar a proposta',
    description:
      'Sem sessão. O cliente desenha a assinatura (PNG), que vale como aceite com as mesmas regras de validade e status. Guarda o PNG e o SHA-256 dele e do conteúdo da proposta. Só funciona com a assinatura ligada no workspace.',
    auth: 'public',
    rateLimit: 'ip',
    params: { shareToken: 'Token do link da proposta.' },
    body: { schema: SignCrmProposalSchema },
    responses: {
      200: {
        description: 'Proposta aceita.',
        schema: CrmProposalPublicDTO,
      },
    },
    errors: [
      PROPOSAL_NOT_FOUND,
      'CRM_PROPOSAL_EXPIRED',
      'CRM_PROPOSAL_NOT_ACCEPTABLE',
      { code: 'BAD_REQUEST', when: 'A assinatura digital não está habilitada' },
    ],
  },
  {
    method: 'post',
    path: '/crm/payments/webhook/{provider}',
    tags: PUBLIC_PROPOSALS,
    summary: 'Aviso de pagamento das cobranças da proposta',
    description:
      'Sem sessão: o provedor autentica a chamada com a assinatura HMAC sobre o corpo cru. Marca a cobrança como paga e leva a oportunidade para ganha. Repetir o aviso não muda nada.',
    auth: 'public',
    rateLimit: 'ip',
    params: { provider: 'Id do provedor (`mock`).' },
    body: {
      schema: z.object({ providerChargeId: z.string(), paidAmount: z.number() }),
    },
    responses: {
      200: { description: 'Avisos processados.', schema: z.object({ processed: z.number().int() }) },
    },
    errors: [
      { code: 'PIX_WEBHOOK_INVALID', when: 'Assinatura inválida' },
      { code: 'RESOURCE_NOT_FOUND', when: 'Provedor desconhecido' },
    ],
  },

  // ─── C8 · seller side ────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/opportunities/{opportunityId}/room`,
    tags: OPPORTUNITIES,
    summary: 'Sala de negociação da oportunidade',
    description: describe(
      'A sala com materiais, plano de ação, visitantes e quem abriu o quê. `null` quando a oportunidade ainda não tem sala.',
      crmAccess('opportunities', 'VIEW'),
    ),
    params: { opportunityId: OPPORTUNITY_ID },
    responses: {
      200: { description: 'Sala ou `null`.', schema: CrmDealRoomDTO.nullable() },
    },
    errors: [...CRM_ERRORS, OPPORTUNITY_NOT_FOUND],
  },
  {
    method: 'put',
    path: `${BASE}/opportunities/{opportunityId}/room`,
    tags: OPPORTUNITIES,
    summary: 'Criar ou editar a sala de negociação',
    description: describe(
      'Cria a sala no primeiro uso e depois edita: liga/desliga o link, proposta exibida, materiais (links) e plano de ação conjunto. Materiais e ações são substituídos pelo que vier (os ausentes saem; os com `id` são atualizados). `rotateToken` troca o link.',
      crmAccess('opportunities', 'EDIT'),
    ),
    consent: true,
    params: { opportunityId: OPPORTUNITY_ID },
    body: {
      schema: UpsertCrmDealRoomSchema,
      example: {
        enabled: true,
        welcomeMessage: 'Aqui você acompanha a nossa negociação.',
        actions: [{ title: 'Enviar o contrato assinado', owner: 'CUSTOMER' }],
      },
    },
    responses: { 200: { description: 'Sala salva.', schema: CrmDealRoomDTO } },
    errors: [...CRM_ERRORS, OPPORTUNITY_NOT_FOUND, ROOM_INVALID],
  },
  {
    method: 'get',
    path: `${BASE}/opportunities/{opportunityId}/room/messages`,
    tags: OPPORTUNITIES,
    summary: 'Conversa da sala de negociação',
    description: describe(
      'Mensagens do vendedor e do cliente, da mais antiga à mais nova.',
      crmAccess('opportunities', 'VIEW'),
    ),
    params: { opportunityId: OPPORTUNITY_ID },
    query: ListDealRoomMessagesQuerySchema,
    responses: {
      200: { description: 'Mensagens.', schema: z.array(DealRoomMessageDTO) },
    },
    errors: [...CRM_ERRORS, ROOM_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/opportunities/{opportunityId}/room/messages`,
    tags: OPPORTUNITIES,
    summary: 'Responder o cliente na sala de negociação',
    description: describe(
      'Escreve na conversa da sala como vendedor.',
      crmAccess('opportunities', 'EDIT'),
    ),
    consent: true,
    params: { opportunityId: OPPORTUNITY_ID },
    body: { schema: CreateDealRoomMessageSchema },
    responses: { 201: { description: 'Mensagem.', schema: DealRoomMessageDTO } },
    errors: [...CRM_ERRORS, ROOM_NOT_FOUND],
  },

  // ─── C8 · public ─────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/crm/deal-rooms/{token}',
    tags: PUBLIC_ROOM,
    summary: 'Sala de negociação (visão do cliente)',
    description:
      'Sem sessão: o token do link é o acesso. Proposta, materiais, plano de ação e conversa.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: TOKEN },
    responses: { 200: { description: 'Sala.', schema: PublicDealRoomDTO } },
    errors: [ROOM_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/crm/deal-rooms/{token}/visitors',
    tags: PUBLIC_ROOM,
    summary: 'Identificar o visitante da sala',
    description:
      'Sem sessão. O visitante informa nome e e-mail e a abertura da sala é registrada. O IP é guardado só como hash (LGPD).',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: TOKEN },
    body: { schema: IdentifyDealRoomVisitorSchema },
    responses: {
      201: { description: 'Visitante.', schema: DealRoomVisitorSessionDTO },
    },
    errors: [ROOM_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/crm/deal-rooms/{token}/events',
    tags: PUBLIC_ROOM,
    summary: 'Registrar o que o visitante abriu',
    description:
      'Sem sessão. Registra a abertura da proposta ou de um material para o vendedor ver quem abriu o quê.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: TOKEN },
    body: { schema: RecordDealRoomEventSchema },
    responses: {
      201: { description: 'Registrado.', schema: z.object({ recorded: z.literal(true) }) },
    },
    errors: [ROOM_NOT_FOUND, ROOM_INVALID],
  },
  {
    method: 'post',
    path: '/crm/deal-rooms/{token}/messages',
    tags: PUBLIC_ROOM,
    summary: 'Escrever na conversa da sala',
    description:
      'Sem sessão. Mensagem do cliente; o responsável pela oportunidade é avisado.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: TOKEN },
    body: { schema: PostDealRoomMessageSchema },
    responses: { 201: { description: 'Mensagem.', schema: DealRoomMessageDTO } },
    errors: [ROOM_NOT_FOUND, ROOM_INVALID],
  },
  {
    method: 'patch',
    path: '/crm/deal-rooms/{token}/actions/{actionId}',
    tags: PUBLIC_ROOM,
    summary: 'Concluir uma ação do plano',
    description:
      'Sem sessão. O cliente marca ou desmarca só as ações dele; devolve o plano atualizado.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: TOKEN, actionId: 'ID da ação do plano.' },
    body: { schema: ToggleDealRoomActionSchema },
    responses: {
      200: {
        description: 'Plano de ação.',
        schema: PublicDealRoomDTO.shape.actions,
      },
    },
    errors: [ROOM_NOT_FOUND, ROOM_INVALID],
  },

  // ─── C9 · contracts ──────────────────────────────────────────────────────
  {
    method: 'get',
    path: `${BASE}/contracts`,
    tags: COMPANIES,
    summary: 'Listar contratos',
    description: describe(
      'Contratos dos clientes, os que vencem primeiro no topo. `endsWithinDays` lista só os ativos que terminam na janela.',
      crmAccess('companies', 'VIEW'),
    ),
    query: ListCrmContractsQuerySchema,
    responses: { 200: { description: 'Contratos.', schema: z.array(CrmContractDTO) } },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/contracts`,
    tags: COMPANIES,
    summary: 'Cadastrar contrato',
    description: describe(
      'Registra o contrato de um cliente para acompanhar a renovação. O responsável padrão é o dono da conta.',
      crmAccess('companies', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmContractSchema,
      example: {
        name: 'Plano anual',
        companyId: 'ckv9x2p0h0000ws7d3k1e5abc',
        value: 24000,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
      },
    },
    responses: { 201: { description: 'Contrato.', schema: CrmContractDTO } },
    errors: [
      ...CRM_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Empresa ou oportunidade inexistente' },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/contracts/{contractId}`,
    tags: COMPANIES,
    summary: 'Ver contrato',
    description: crmAccess('companies', 'VIEW'),
    params: { contractId: CONTRACT_ID },
    responses: { 200: { description: 'Contrato.', schema: CrmContractDTO } },
    errors: [...CRM_ERRORS, CONTRACT_NOT_FOUND],
  },
  {
    method: 'patch',
    path: `${BASE}/contracts/{contractId}`,
    tags: COMPANIES,
    summary: 'Editar contrato',
    description: describe(
      'Uma nova data de fim reabre a janela de aviso de renovação.',
      crmAccess('companies', 'EDIT'),
    ),
    consent: true,
    params: { contractId: CONTRACT_ID },
    body: { schema: UpdateCrmContractSchema },
    responses: { 200: { description: 'Contrato.', schema: CrmContractDTO } },
    errors: [...CRM_ERRORS, CONTRACT_NOT_FOUND],
  },
  {
    method: 'delete',
    path: `${BASE}/contracts/{contractId}`,
    tags: COMPANIES,
    summary: 'Remover contrato',
    description: crmAccess('companies', 'DELETE'),
    consent: true,
    params: { contractId: CONTRACT_ID },
    responses: {
      200: { description: 'Removido.', schema: z.object({ deleted: z.literal(true) }) },
    },
    errors: [...CRM_ERRORS, CONTRACT_NOT_FOUND],
  },
  {
    method: 'post',
    path: `${BASE}/contracts/{contractId}/renew`,
    tags: COMPANIES,
    summary: 'Abrir a oportunidade de renovação agora',
    description: describe(
      'Cria a oportunidade de renovação sem esperar a janela: mesmo pipeline da venda original (ou o padrão), primeira etapa em aberto, valor e data de fechamento do contrato.',
      crmAccess('opportunities', 'CREATE'),
    ),
    consent: true,
    params: { contractId: CONTRACT_ID },
    responses: { 201: { description: 'Contrato com a renovação.', schema: CrmContractDTO } },
    errors: [...CRM_ERRORS, CONTRACT_NOT_FOUND, CONTRACT_INVALID],
  },
  {
    method: 'post',
    path: `${BASE}/contracts/scan`,
    tags: COMPANIES,
    summary: 'Rodar a varredura de renovações agora',
    description: describe(
      'Faz o que o job diário faz neste workspace: avisa o responsável dos contratos na janela, cria as oportunidades de renovação, renova os automáticos e encerra os vencidos.',
      crmAccess('privileged'),
    ),
    consent: true,
    responses: {
      200: { description: 'Resultado.', schema: CrmRenewalScanResultDTO },
    },
    errors: CRM_PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: `${BASE}/companies/{companyId}/upsell`,
    tags: COMPANIES,
    summary: 'Sugestões de expansão para o cliente',
    description: describe(
      'Produtos que clientes parecidos compraram e este ainda não, mais o momento de oferecer: usa a última pesquisa de satisfação respondida (NPS/CSAT/CES) e a saúde do cliente. Com risco alto ou nota baixa o momento é `WAIT`.',
      crmAccess('companies', 'VIEW'),
    ),
    params: { companyId: 'ID da empresa.' },
    responses: { 200: { description: 'Sugestões.', schema: CrmUpsellDTO } },
    errors: [
      ...CRM_ERRORS,
      { code: 'RESOURCE_NOT_FOUND', when: 'Empresa inexistente no workspace' },
    ],
  },
]
