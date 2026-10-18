import { z } from 'zod'
import { dto } from '../common'
import {
  CrmPipelineDTO,
  CrmPipelineStageDTO,
} from '../schemas/crm/opportunities'

/**
 * DTOs that only exist in the public API v1 (`types/api-v1.ts`). Every
 * other v1 response reuses the app's component (`SdTicket`, `CrmLead`...),
 * so the v1 compatibility check also guards those shapes.
 */

/** `{ items, nextCursor }` page of a v1 list (`src/lib/api/v1-pagination.ts`). */
export function v1Page<T extends z.ZodType>(name: string, item: T) {
  return dto(
    `V1${name}Page`,
    z.object({
      items: z.array(item),
      nextCursor: z.string().nullable().meta({
        description:
          'Passe em `?cursor=` para a próxima página; `null` = última página.',
      }),
    }),
  )
}

/*
 * Component names below (`Me`, `ApiScope`, `ModuleKind`, `WorkspaceRef`,
 * `DeviceAuthorization*`, `DeviceToken`) are what the generated SDK
 * exports as types (`steel-so/steel-cli`, packages/sdk/src/models.ts):
 * renaming one breaks the SDK build even when the shape is the same.
 */

export const ApiScopeDTO = dto('ApiScope', z.enum(['api:read', 'api:write']))

export const ModuleKindDTO = dto(
  'ModuleKind',
  z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION']),
)

export const WorkspaceRefDTO = dto(
  'WorkspaceRef',
  z.object({
    id: z.string().meta({ example: 'ckv9x2p0h0000ws7d3k1e5abc' }),
    slug: z.string().meta({ example: 'empresa' }),
    name: z.string().meta({ example: 'Empresa' }),
  }),
)

export const ApiV1MeDTO = dto(
  'Me',
  z.object({
    user: z.object({
      id: z.string().meta({ example: 'ckv9x2p0h0000us7d3k1e5abc' }),
      name: z.string().meta({ example: 'Ana Souza' }),
      email: z.string().meta({ example: 'ana@empresa.com.br' }),
    }),
    workspace: WorkspaceRefDTO,
    role: z.string().meta({
      description: 'Papel no workspace (`OWNER`, `ADMIN`, `MEMBER`...).',
      example: 'MEMBER',
    }),
    scopes: z.array(ApiScopeDTO),
    modules: z.array(ModuleKindDTO).meta({
      description: 'Módulos do token que seguem habilitados no workspace.',
    }),
    token: z.object({
      id: z.string(),
      expiresAt: z.iso.datetime(),
    }),
  }),
)

/* Device flow of `steel login` (routes of the api-tokens slice). */

export const DeviceAuthorizationRequestDTO = dto(
  'DeviceAuthorizationRequest',
  z.object({
    clientName: z.string().min(1).max(100).optional().meta({
      description:
        'Cliente e versão (`steel-cli/1.2.0`); só vai para a auditoria.',
    }),
    deviceName: z.string().min(1).max(100).optional().meta({
      description: 'Nome da máquina: o token se chama "Steel CLI — <máquina>".',
    }),
  }),
)

export const DeviceAuthorizationDTO = dto(
  'DeviceAuthorization',
  z.object({
    deviceCode: z.string().meta({
      description: 'Segredo do CLI para consultar `/api/v1/auth/device/token`.',
    }),
    userCode: z.string().meta({ example: 'BCDF-GH23' }),
    verificationUri: z.url(),
    verificationUriComplete: z.url(),
    interval: z.number().int().meta({
      description: 'Segundos entre consultas.',
      example: 5,
    }),
    expiresIn: z.number().int().meta({
      description: 'Segundos até o código expirar.',
      example: 600,
    }),
  }),
)

export const DeviceTokenPollDTO = dto(
  'DeviceTokenRequest',
  z.object({ deviceCode: z.string().min(16).max(128) }),
)

export const DeviceTokenDTO = dto(
  'DeviceToken',
  z.object({
    token: z.string().meta({
      description: 'O token pessoal. Só aparece nesta resposta.',
      example: 'stl_pat_…',
    }),
    tokenId: z.string(),
    expiresAt: z.iso.datetime(),
    workspace: WorkspaceRefDTO,
    scopes: z.array(ApiScopeDTO),
    modules: z.array(ModuleKindDTO),
  }),
)

export const ApiV1CrmPipelineDTO = dto(
  'ApiV1CrmPipeline',
  z.object({
    ...CrmPipelineDTO.shape,
    stages: z.array(CrmPipelineStageDTO).meta({
      description: 'Etapas do funil, na ordem.',
    }),
  }),
)

export const ApiV1LeadImportResultDTO = dto(
  'ApiV1LeadImportResult',
  z.object({
    total: z.number().int().meta({ description: 'Linhas de dados lidas.' }),
    created: z.number().int(),
    skipped: z.number().int().meta({
      description:
        'Linhas iguais a um lead em aberto (mesmo e-mail ou telefone): não duplicam.',
    }),
    errors: z.array(
      z.object({
        row: z.number().int().meta({
          description: 'Linha do CSV (o cabeçalho é a linha 1).',
          example: 7,
        }),
        code: z.string().meta({ example: 'VALIDATION_ERROR' }),
        message: z.string().meta({
          example: 'Informe ao menos um e-mail ou telefone',
        }),
      }),
    ),
  }),
)
