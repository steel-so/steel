import { z } from 'zod'
import {
  CreateSdLicenseSchema,
  ListSdLicensesQuerySchema,
  SetSdLicenseAssetsSchema,
  UpdateSdLicenseSchema,
} from '@/src/schemas/sd-license.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  SdConfigItemLicenseDTO,
  SdLicenseDetailDTO,
  SdLicenseDTO,
  SdLicenseListDTO,
} from '../../schemas/servicedesk/licenses'

/**
 * ServiceDesk · licenças de software (S7): pool de licenças contra o software
 * instalado do inventário (S1), conformidade e avisos de vencimento.
 */

const TAG = 'ServiceDesk · Inventário' as const
const BASE = '/workspaces/{id}/servicedesk/licenses'
const ITEM = `${BASE}/{licenseId}`
const WS = { id: 'Id do workspace.' }
const LICENSE = { ...WS, licenseId: 'Id da licença.' }

const AGENT =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; **agentes** do módulo.'
const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'
const AGENT_ERRORS: ErrorEntry[] = [
  { code: 'SD_NOT_AGENT', when: 'Solicitante sem departamento' },
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]
const ADMIN_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    message:
      'Apenas administradores do ServiceDesk podem alterar a configuração',
    when: 'Não é membro ou não é admin do módulo',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
]

export const sdLicenseRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: [TAG],
    summary: 'Listar licenças de software',
    description: `Cada licença traz a conformidade: instalações (software do inventário cujo nome contém \`matchPattern\`) contra o total de licenças, e o estado do vencimento. \`summary\` resume o conjunto inteiro, mesmo com \`status\` filtrado. ${AGENT}`,
    params: WS,
    query: ListSdLicensesQuerySchema,
    responses: { 200: { description: 'Licenças.', schema: SdLicenseListDTO } },
    errors: AGENT_ERRORS,
  },
  {
    method: 'post',
    path: BASE,
    tags: [TAG],
    summary: 'Cadastrar licença',
    description: `Nenhuma chave de licença é guardada. ${ADMIN}`,
    consent: true,
    params: WS,
    body: CreateSdLicenseSchema,
    responses: {
      201: { description: 'Licença criada.', schema: SdLicenseDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_LICENSE_INVALID'],
  },
  {
    method: 'get',
    path: ITEM,
    tags: [TAG],
    summary: 'Detalhar licença',
    description: `Traz os ativos atribuídos, os equipamentos com o software instalado (até 200) e quantos estão sem licença atribuída. ${AGENT}`,
    params: LICENSE,
    responses: { 200: { description: 'Licença.', schema: SdLicenseDetailDTO } },
    errors: [...AGENT_ERRORS, 'SD_LICENSE_NOT_FOUND'],
  },
  {
    method: 'patch',
    path: ITEM,
    tags: [TAG],
    summary: 'Atualizar licença',
    description: `Mudar o vencimento ou a antecedência do aviso rearma os avisos. ${ADMIN}`,
    consent: true,
    params: LICENSE,
    body: UpdateSdLicenseSchema,
    responses: { 200: { description: 'Licença salva.', schema: SdLicenseDTO } },
    errors: [...ADMIN_ERRORS, 'SD_LICENSE_NOT_FOUND', 'SD_LICENSE_INVALID'],
  },
  {
    method: 'delete',
    path: ITEM,
    tags: [TAG],
    summary: 'Arquivar licença',
    description: `Some das listas e dos avisos; \`restore\` desfaz. ${ADMIN}`,
    consent: true,
    params: LICENSE,
    responses: {
      200: { description: 'Licença arquivada.', schema: SdLicenseDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_LICENSE_NOT_FOUND'],
  },
  {
    method: 'post',
    path: `${ITEM}/restore`,
    tags: [TAG],
    summary: 'Restaurar licença arquivada',
    description: ADMIN,
    consent: true,
    params: LICENSE,
    responses: {
      200: { description: 'Licença restaurada.', schema: SdLicenseDTO },
    },
    errors: [...ADMIN_ERRORS, 'SD_LICENSE_NOT_FOUND'],
  },
  {
    method: 'put',
    path: `${ITEM}/assets`,
    tags: [TAG],
    summary: 'Definir os ativos cobertos pela licença',
    description: `Substitui o conjunto de ativos da CMDB atribuídos à licença (até 500). ${ADMIN}`,
    consent: true,
    params: LICENSE,
    body: SetSdLicenseAssetsSchema,
    responses: { 200: { description: 'Licença salva.', schema: SdLicenseDTO } },
    errors: [...ADMIN_ERRORS, 'SD_LICENSE_NOT_FOUND', 'SD_LICENSE_INVALID'],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/servicedesk/config-items/{itemId}/licenses',
    tags: [TAG],
    summary: 'Licenças de um ativo da CMDB',
    description: `Licenças de software atribuídas ao ativo, com o estado do vencimento. ${AGENT}`,
    params: { ...WS, itemId: 'Id do ativo da CMDB.' },
    responses: {
      200: {
        description: 'Licenças do ativo.',
        schema: z.array(SdConfigItemLicenseDTO),
      },
    },
    errors: AGENT_ERRORS,
  },
]
