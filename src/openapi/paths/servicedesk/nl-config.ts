import { z } from 'zod'
import {
  SdNlConfigApplySchema,
  SdNlConfigKindEnum,
  SdNlConfigPreviewSchema,
} from '@/src/schemas/sd-nl-config.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'

/** ServiceDesk · configuração em linguagem natural (S8). */

const TAG = 'ServiceDesk · Configurações' as const
const BASE = '/workspaces/{id}/servicedesk/nl-config'
const WS = { id: 'Id do workspace.' }

const ADMIN =
  'Acesso: sessão + módulo **ServiceDesk** habilitado; só **admins do módulo** (OWNER/ADMIN ou perfil com `sd-settings` × `EDIT`).'
const ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    message:
      'Apenas administradores do ServiceDesk podem alterar a configuração',
    when: 'Não é membro ou não é admin do módulo',
  },
  'WORKSPACE_SUSPENDED',
  { code: 'MODULE_DISABLED', when: 'Módulo ServiceDesk desabilitado' },
  'SD_CONFIG_NOT_FOUND',
]

const DiffRow = z.object({
  field: z.string(),
  label: z.string(),
  before: z.string(),
  after: z.string(),
})

const PreviewDTO = z.object({
  kind: SdNlConfigKindEnum,
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  mode: z.enum(['create', 'update']),
  summary: z.string(),
  warnings: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
  lines: z.array(z.string()),
  diff: z.array(DiffRow).nullable(),
})

const ApplyDTO = z.object({
  kind: SdNlConfigKindEnum,
  mode: z.enum(['create', 'update']),
  id: z.string(),
  name: z.string(),
})

export const sdNlConfigRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: `${BASE}/preview`,
    tags: [TAG],
    summary: 'Prévia de uma configuração descrita em texto',
    description: `O admin descreve uma política de SLA, uma regra de automação ou de escalonamento; a IA monta a configuração, validada com o mesmo schema de criação, e o servidor devolve a prévia (descrição legível, avisos e, ao ajustar uma regra existente via \`targetId\`, o diff campo a campo). **Nada é salvo.** O modelo só recebe o texto e os nomes/ids de referência do workspace, nunca dados de chamados. Consome a cota mensal de IA. ${ADMIN}`,
    consent: true,
    params: WS,
    body: SdNlConfigPreviewSchema,
    responses: { 200: { description: 'Prévia.', schema: PreviewDTO } },
    errors: [
      ...ERRORS,
      'SD_AI_DISABLED',
      'AI_QUOTA_EXCEEDED',
      'SD_NL_CONFIG_FAILED',
      'SD_NL_CONFIG_INVALID',
    ],
  },
  {
    method: 'post',
    path: `${BASE}/apply`,
    tags: [TAG],
    summary: 'Aplicar a configuração confirmada na prévia',
    description: `Revalida o \`config\` no servidor e cria (ou, com \`targetId\`, atualiza) a política ou a regra pelo service do tipo, que confere as referências e audita. ${ADMIN}`,
    consent: true,
    params: WS,
    body: SdNlConfigApplySchema,
    responses: {
      201: { description: 'Configuração salva.', schema: ApplyDTO },
    },
    errors: [...ERRORS, 'VALIDATION_ERROR'],
  },
]
