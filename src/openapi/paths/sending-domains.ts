import { CreateSendingDomainSchema } from '@/src/schemas/sending-domain.schema'
import { WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'
import { SendingDomainDTO } from '../schemas/sending-domain'

/**
 * Domínios de envio da newsletter do CRM (ADR 0054): Ajustes › Domínios de
 * e-mail (`/workspaces/{id}/sending-domains/**`).
 */

const TAG = 'Configurações do workspace' as const

const WHO =
  'Só OWNER/ADMIN de um workspace com o módulo CRM habilitado.' as const

const ERRORS: ErrorEntry[] = [
  ...WORKSPACE_PRIVILEGED_ERRORS,
  'WORKSPACE_IP_NOT_ALLOWED',
  'MODULE_DISABLED',
]

const NOT_FOUND: ErrorEntry = {
  code: 'SENDING_DOMAIN_NOT_FOUND',
  when: 'Domínio inexistente ou de outro workspace',
}

const PROVIDER: ErrorEntry = {
  code: 'SENDING_DOMAIN_PROVIDER_ERROR',
  when: 'O Resend falhou ou não respondeu',
}

const PARAMS = { id: 'ID do workspace.', domainId: 'ID do domínio.' }

const routes: RouteConfig[] = [
  {
    method: 'get',
    path: '/workspaces/{id}/sending-domains',
    tags: [TAG],
    summary: 'Listar domínios de envio',
    description: `Domínios do workspace, mais antigos primeiro, com o número de newsletters ativas de cada um (sem a consulta de DMARC). ${WHO}`,
    params: { id: 'ID do workspace.' },
    responses: {
      200: { description: 'Domínios.', schema: SendingDomainDTO.array() },
    },
    errors: ERRORS,
  },
  {
    method: 'post',
    path: '/workspaces/{id}/sending-domains',
    tags: [TAG],
    summary: 'Cadastrar domínio de envio',
    description: `Cadastra o domínio no Resend (com rastreamento de abertura e clique) e devolve os registros DNS a publicar. Recomendado um subdomínio dedicado, como \`news.suaempresa.com.br\`. Recusa provedores de e-mail gratuitos e terminações públicas (\`com.br\`). O nome é único na plataforma. ${WHO}`,
    consent: true,
    params: { id: 'ID do workspace.' },
    body: CreateSendingDomainSchema,
    responses: {
      201: { description: 'Domínio cadastrado.', schema: SendingDomainDTO },
    },
    errors: [
      ...ERRORS,
      'SENDING_DOMAIN_INVALID',
      'SENDING_DOMAIN_TAKEN',
      PROVIDER,
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/sending-domains/{domainId}',
    tags: [TAG],
    summary: 'Detalhar domínio de envio',
    description: `Registros DNS, status e a consulta DMARC de \`_dmarc.<domínio raiz>\` (sugere \`v=DMARC1; p=none;\` quando não há). ${WHO}`,
    params: PARAMS,
    responses: { 200: { description: 'Domínio.', schema: SendingDomainDTO } },
    errors: [...ERRORS, NOT_FOUND],
  },
  {
    method: 'post',
    path: '/workspaces/{id}/sending-domains/{domainId}/verify',
    tags: [TAG],
    summary: 'Verificar domínio agora',
    description: `Pede ao Resend uma nova verificação do DNS e grava o resultado (status, registros, motivo da falha). Um domínio verificado só deixa de estar verificado por falha. Avisa os administradores quando o domínio passa a verificado. ${WHO}`,
    consent: true,
    params: PARAMS,
    responses: { 200: { description: 'Domínio.', schema: SendingDomainDTO } },
    errors: [...ERRORS, NOT_FOUND, PROVIDER],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/sending-domains/{domainId}',
    tags: [TAG],
    summary: 'Remover domínio de envio',
    description: `Remove do Resend e do Steel. Recusado enquanto alguma newsletter ativa envia dele. ${WHO}`,
    consent: true,
    params: PARAMS,
    responses: { 200: { description: 'Removido (`data: null`).' } },
    errors: [...ERRORS, NOT_FOUND, 'SENDING_DOMAIN_IN_USE', PROVIDER],
  },
]

export function registerSendingDomainPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
