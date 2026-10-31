import { z } from 'zod'
import {
  CreateWhatsAppPixChargeSchema,
  UpdateWhatsAppPixSettingsSchema,
} from '@/src/schemas/whatsapp-pix.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppPixChargeDTO,
  WhatsAppPixSettingsDTO,
} from '../../schemas/whatsapp'
import {
  CONVERSATION_PARAM,
  MEMBER,
  MEMBER_ERRORS,
  PRIVILEGED,
  PRIVILEGED_ERRORS,
  perm,
  permErrors,
} from './shared'

const TAG = 'Comunicação · Pix' as const
const BASE = '/workspaces/{id}/whatsapp/conversations/{conversationId}/pix'
const PARAMS = { conversationId: CONVERSATION_PARAM }
const CHARGE_PARAMS = { ...PARAMS, chargeId: 'Id da cobrança Pix.' }

const REALTIME =
  'A cobrança atualizada é publicada no SSE `GET /whatsapp/events` (`pix-charge.updated`).'

const PROVIDER_NOTE =
  'O provedor de Pix (PSP) ainda não foi escolhido: as cobranças saem por uma interface (`PixProvider`) e só existe o provedor de teste `mock`, que gera um BR Code válido que nenhum banco liquida.'

const SEND_ERRORS = [
  ...permErrors('conversations', 'CREATE'),
  'PIX_DISABLED',
  'WHATSAPP_CONVERSATION_NOT_FOUND',
  'WHATSAPP_CONVERSATION_AI_HANDLING',
  'WHATSAPP_CONNECTION_NOT_FOUND',
  'WHATSAPP_PROVIDER_ERROR',
  'PIX_PROVIDER_ERROR',
  {
    code: 'BAD_REQUEST',
    when: '`opportunityId` não existe neste workspace',
  },
] satisfies RouteConfig['errors']

export const pixRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/pix/settings',
    tags: [TAG],
    summary: 'Configuração do Pix na conversa',
    description: `Liga/desliga e validade padrão. Workspace que nunca salvou recebe o padrão (desligado, 60 min). ${MEMBER}`,
    responses: {
      200: { description: 'Configuração.', schema: WhatsAppPixSettingsDTO },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/pix/settings',
    tags: [TAG],
    summary: 'Atualizar a configuração do Pix',
    description: `Upsert parcial (omitido = mantém). ${PROVIDER_NOTE} Auditado. ${PRIVILEGED}`,
    body: UpdateWhatsAppPixSettingsSchema,
    responses: {
      200: {
        description: 'Configuração salva.',
        schema: WhatsAppPixSettingsDTO,
      },
    },
    errors: PRIVILEGED_ERRORS,
  },
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Listar cobranças Pix da conversa',
    description: `As 50 cobranças mais recentes, a mais nova primeiro. ${perm('conversations', 'VIEW')}`,
    params: PARAMS,
    responses: {
      200: {
        description: 'Cobranças.',
        schema: z.array(WhatsAppPixChargeDTO),
      },
    },
    errors: [
      ...permErrors('conversations', 'VIEW'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    ],
  },
  {
    method: 'post',
    path: BASE,
    tags: [TAG],
    summary: 'Enviar cobrança Pix',
    description: `Cria a cobrança no PSP e envia duas mensagens ao contato: o resumo (valor, descrição e validade) e o código "copia e cola" sozinho, para copiar com um toque. \`expiresInMinutes\` omitido usa a validade padrão do workspace; \`opportunityId\` liga a cobrança a uma oportunidade do CRM, que recebe uma anotação quando o pagamento chega. Se as mensagens não chegarem ao contato, a cobrança é cancelada. ${PROVIDER_NOTE} ${REALTIME} Auditado. ${perm('conversations', 'CREATE')} Respeita o horário de atendimento e a conversa não pode estar com a IA.`,
    params: PARAMS,
    body: CreateWhatsAppPixChargeSchema,
    responses: {
      201: { description: 'Cobrança enviada.', schema: WhatsAppPixChargeDTO },
    },
    errors: SEND_ERRORS,
  },
  {
    method: 'delete',
    path: `${BASE}/{chargeId}`,
    tags: [TAG],
    summary: 'Cancelar cobrança Pix',
    description: `Cancela uma cobrança que ainda aguarda pagamento (no PSP e no Steel). ${REALTIME} Auditado. ${perm('conversations', 'EDIT')}`,
    params: CHARGE_PARAMS,
    responses: {
      200: { description: 'Cobrança cancelada.', schema: WhatsAppPixChargeDTO },
    },
    errors: [
      ...permErrors('conversations', 'EDIT'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
      'PIX_CHARGE_NOT_FOUND',
      {
        code: 'PIX_CHARGE_NOT_PENDING',
        when: 'A cobrança já foi paga, cancelada ou venceu',
      },
      'PIX_PROVIDER_ERROR',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/{chargeId}/simulate-payment`,
    tags: [TAG],
    summary: 'Simular o pagamento (provedor de teste)',
    description: `Liquida a cobrança como se o contato tivesse pago o valor cobrado, para testar o fluxo todo: a conversa recebe o aviso "Pix recebido" e a oportunidade ligada recebe a anotação. Só vale para cobranças de um provedor de teste. ${REALTIME} Auditado. ${PRIVILEGED}`,
    params: CHARGE_PARAMS,
    responses: {
      200: { description: 'Cobrança paga.', schema: WhatsAppPixChargeDTO },
    },
    errors: [
      {
        code: 'FORBIDDEN',
        when: 'Não é membro, não é OWNER/ADMIN ou a cobrança é de um provedor real',
      },
      'WORKSPACE_SUSPENDED',
      'MODULE_DISABLED',
      'PIX_CHARGE_NOT_FOUND',
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/crm/opportunities/{opportunityId}/pix',
    tags: [TAG],
    summary: 'Cobranças Pix de uma oportunidade',
    description:
      'As cobranças enviadas nas conversas do WhatsApp para esta oportunidade (50 mais recentes). Módulo **CRM** habilitado e permissão `opportunities` × `VIEW` no perfil (OWNER/ADMIN sempre passam).',
    params: { opportunityId: 'Id da oportunidade do CRM.' },
    responses: {
      200: {
        description: 'Cobranças.',
        schema: z.array(WhatsAppPixChargeDTO),
      },
    },
    errors: [
      ...permErrors('opportunities', 'VIEW'),
      { code: 'RESOURCE_NOT_FOUND', when: 'Oportunidade inexistente' },
    ],
  },
  {
    method: 'post',
    path: '/whatsapp/webhook/pix/{provider}',
    tags: [TAG],
    summary: 'Aviso de pagamento (PSP)',
    description: `Chamado pelo PSP quando um Pix é pago. Público: o próprio provedor autentica a chamada. No \`abacatepay\`, a chamada traz \`?webhookSecret=<PIX_WEBHOOK_SECRET>\` na URL e o header \`X-Webhook-Signature\` (HMAC-SHA256 em base64 do corpo cru); só o evento \`transparent.completed\` baixa cobrança, os demais são autenticados e ignorados. No \`mock\`, o corpo JSON vem assinado com HMAC-SHA256 (hex) em \`x-pix-signature\`, com o segredo \`PIX_WEBHOOK_SECRET\`; sem segredo configurado toda chamada é recusada. Idempotente: um aviso repetido não muda nada. Avisos de cobranças desconhecidas são ignorados. Marca a cobrança como paga, registra "Pix recebido" na conversa e anota a oportunidade ligada. ${REALTIME}`,
    auth: 'public',
    params: { provider: 'Id do provedor de Pix (`mock` ou `abacatepay`).' },
    body: {
      schema: {
        type: 'object',
        required: ['providerChargeId', 'paidAmount'],
        properties: {
          providerChargeId: {
            type: 'string',
            description: 'Id da cobrança no PSP.',
          },
          paidAmount: {
            type: 'number',
            description: 'Valor recebido, em reais.',
          },
          paidAt: { type: 'string', format: 'date-time' },
          endToEndId: { type: 'string' },
          payerName: { type: 'string' },
        },
      },
      example: { providerChargeId: '9f2c…', paidAmount: 150 },
    },
    responses: {
      200: {
        description: 'Avisos processados.',
        schema: z.object({ processed: z.number().int() }),
      },
    },
    errors: [
      { code: 'PIX_WEBHOOK_INVALID', when: 'Assinatura ausente ou inválida' },
      { code: 'RESOURCE_NOT_FOUND', when: 'Provedor desconhecido' },
      'RATE_LIMITED',
    ],
  },
]
