import { z } from 'zod'
import {
  CreateWhatsAppConnectionSchema,
  MetaEmbeddedSignupSchema,
  UpdateWhatsAppConnectionSchema,
} from '@/src/schemas/whatsapp-connection.schema'
import type { RouteConfig } from '../../registry'
import {
  WhatsAppConnectionCreatedDTO,
  WhatsAppConnectionDTO,
  WhatsAppQrCodeDTO,
} from '../../schemas/whatsapp'
import {
  CONNECTION_PARAM,
  MEMBER,
  MEMBER_ERRORS,
  PRIVILEGED,
  PRIVILEGED_ERRORS,
} from './shared'

const TAG = 'Comunicação · Conexões' as const

export const connectionRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/connections',
    tags: [TAG],
    summary: 'Listar conexões',
    description: `Conexões do workspace com a Z-API e a Meta Cloud API. ${MEMBER}`,
    responses: {
      200: {
        description: 'Conexões.',
        schema: z.array(WhatsAppConnectionDTO),
      },
    },
    errors: MEMBER_ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/connections',
    tags: [TAG],
    summary: 'Criar conexão',
    description: `Cadastra um número do WhatsApp. O corpo é discriminado por \`provider\`:

- \`ZAPI\`: \`zapiInstanceId\`, \`zapiToken\` e, se a instância exigir, \`zapiClientToken\`. Depois de criar, pareie o aparelho com \`GET .../qr-code\` e cadastre na Z-API a URL \`/api/whatsapp/webhook/zapi?secret=<webhookSecret>\`.
- \`META\`: \`metaPhoneNumberId\`, \`metaWabaId\` e \`metaAccessToken\` (token de sistema). O webhook da Meta é global (\`/api/whatsapp/webhook/meta\`), roteado pelo \`phone_number_id\`.

Os tokens são cifrados com \`CONNECTION_SECRETS\`. A resposta traz o \`webhookSecret\` — **única vez** em que ele é devolvido. Auditado. ${PRIVILEGED}`,
    body: CreateWhatsAppConnectionSchema,
    responses: {
      201: {
        description: 'Conexão criada (com o segredo do webhook).',
        schema: WhatsAppConnectionCreatedDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      {
        code: 'WHATSAPP_CONNECTION_CONFLICT',
        when: 'Número já cadastrado neste workspace para o mesmo provedor',
      },
    ],
  },
  {
    method: 'patch',
    path: '/workspaces/{id}/whatsapp/connections/{connectionId}',
    tags: [TAG],
    summary: 'Atualizar conexão',
    description: `Renomeia a conexão ou troca as credenciais (tokens da Z-API ou access token da Meta). Provedor, número e ids do provedor não mudam — para isso, crie outra conexão. Auditado. ${PRIVILEGED}`,
    params: { connectionId: CONNECTION_PARAM },
    body: UpdateWhatsAppConnectionSchema,
    responses: {
      200: {
        description: 'Conexão atualizada.',
        schema: WhatsAppConnectionDTO,
      },
    },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_CONNECTION_NOT_FOUND'],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/whatsapp/connections/{connectionId}',
    tags: [TAG],
    summary: 'Excluir conexão',
    description: `Remove a conexão (e, em cascata, as conversas, transmissões, templates e grupos ligados a ela). Auditado. ${PRIVILEGED}`,
    params: { connectionId: CONNECTION_PARAM },
    responses: { 200: { description: 'Conexão excluída.', schema: null } },
    errors: [...PRIVILEGED_ERRORS, 'WHATSAPP_CONNECTION_NOT_FOUND'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/whatsapp/connections/{connectionId}/qr-code',
    tags: [TAG],
    summary: 'QR code de pareamento (Z-API)',
    description: `Consulta a instância na Z-API: se já está pareada devolve \`status: connected\`; senão devolve o QR code para escanear no aparelho. Atualiza o \`status\` da conexão (\`CONNECTED\`/\`CONNECTING\`). Só para conexões \`ZAPI\`. Uma falha de rede/credencial na Z-API não é tratada e resulta em erro 500. ${PRIVILEGED}`,
    params: { connectionId: CONNECTION_PARAM },
    responses: {
      200: { description: 'Estado do pareamento.', schema: WhatsAppQrCodeDTO },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_CONNECTION_NOT_FOUND',
      {
        code: 'BAD_REQUEST',
        message: 'QR code está disponível apenas para conexões Z-API',
        when: 'Conexão Meta',
      },
      {
        code: 'BAD_REQUEST',
        message: 'Conexão Z-API sem credenciais configuradas',
        when: 'Conexão Z-API sem instância/token',
      },
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/connections/embedded-signup',
    tags: [TAG],
    summary: 'Conectar número pela Meta (Embedded Signup)',
    description: `Recebe o resultado do popup do WhatsApp Embedded Signup (\`code\`, \`phoneNumberId\`, \`wabaId\`), troca o código por um token de integração, inscreve o app na WABA, registra o número na Cloud API com um PIN aleatório (guardado cifrado) e cria a conexão \`META\`, já verificada. Auditado. ${PRIVILEGED}`,
    body: MetaEmbeddedSignupSchema,
    responses: {
      201: {
        description: 'Conexão criada (com o segredo do webhook).',
        schema: WhatsAppConnectionCreatedDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'FEATURE_NOT_ENABLED',
      'WHATSAPP_CONNECTION_CONFLICT',
      'WHATSAPP_SIGNUP_PAYMENT_REQUIRED',
      'WHATSAPP_SIGNUP_NAME_NOT_APPROVED',
      'WHATSAPP_SIGNUP_PERMISSION_DENIED',
      'WHATSAPP_PROVIDER_ERROR',
    ],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/whatsapp/connections/{connectionId}/status',
    tags: [TAG],
    summary: 'Verificar status da conexão (Meta)',
    description: `Consulta o número na Graph API (\`status\` e \`health_status\`) e atualiza a conexão para \`CONNECTED\`, \`ERROR\` ou \`DISCONNECTED\`, com o motivo em pt-BR em \`statusError\`. Só para conexões \`META\`. ${PRIVILEGED}`,
    params: { connectionId: CONNECTION_PARAM },
    responses: {
      200: {
        description: 'Conexão atualizada.',
        schema: WhatsAppConnectionDTO,
      },
    },
    errors: [
      ...PRIVILEGED_ERRORS,
      'WHATSAPP_CONNECTION_NOT_FOUND',
      'BAD_REQUEST',
    ],
  },
]
