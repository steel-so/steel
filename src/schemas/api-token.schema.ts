import z from 'zod'
import { API_SCOPES } from '@/src/lib/api/session'
import { API_TOKEN_DEFAULT_DAYS, API_TOKEN_MAX_DAYS } from '@/src/lib/api/token'

/**
 * Contract of personal API tokens and of the CLI device flow (ADR 0035,
 * docs/cli/README.md).
 */

export const ApiModuleSchema = z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])
export const ApiScopeSchema = z.enum(API_SCOPES)

const ModulesSchema = z
  .array(ApiModuleSchema)
  .min(1, 'Escolha pelo menos um módulo')
  .max(10)
  .transform((modules) => [...new Set(modules)])

const ScopesSchema = z
  .array(ApiScopeSchema)
  .min(1)
  .max(10)
  .transform((scopes) => [...new Set(scopes)])
  .refine((scopes) => scopes.includes('api:read'), {
    message: 'A leitura é obrigatória',
  })

const ExpiresInDaysSchema = z
  .number()
  .int('Informe um número inteiro de dias')
  .min(1, 'A validade mínima é de 1 dia')
  .max(API_TOKEN_MAX_DAYS, `A validade máxima é de ${API_TOKEN_MAX_DAYS} dias`)
  .default(API_TOKEN_DEFAULT_DAYS)

/** Body of `POST /api/users/me/api-tokens` (Configurações › Segurança). */
export const CreateApiTokenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Dê um nome ao token')
    .max(100, 'Use até 100 caracteres'),
  workspaceId: z.string().min(1).max(64),
  scopes: ScopesSchema,
  modules: ModulesSchema,
  expiresInDays: ExpiresInDaysSchema,
})

export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>

export const ApiTokenIdSchema = z.string().min(1).max(64)

/** Body of `POST /api/v1/auth/device` (all optional). */
export const DeviceAuthorizationStartSchema = z
  .object({
    /** Which client is logging in (e.g. `steel-cli/1.2.0`), for the audit. */
    clientName: z.string().trim().min(1).max(100).optional(),
    /** Machine name, for the token name "Steel CLI — <máquina>". */
    deviceName: z.string().trim().min(1).max(100).optional(),
  })
  .default({})

export type DeviceAuthorizationStartInput = z.infer<
  typeof DeviceAuthorizationStartSchema
>

/** Body of `POST /api/v1/auth/device/token`. */
export const DeviceTokenPollSchema = z.object({
  deviceCode: z.string().min(16).max(128),
})

/**
 * What the user types on `/device`: case and separators don't matter
 * (`abcd-efgh`, `ABCD EFGH` and `ABCDEFGH` are the same code).
 */
export const UserCodeSchema = z
  .string()
  .max(32)
  .transform((value) => value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(8, 'O código tem 8 caracteres'))

/** Body of `POST /api/device/authorize`: the answer given on `/device`. */
export const DeviceAuthorizeSchema = z.discriminatedUnion('accept', [
  z.object({
    accept: z.literal(true),
    userCode: UserCodeSchema,
    workspaceId: z.string().min(1).max(64),
    modules: ModulesSchema,
    scopes: ScopesSchema,
    expiresInDays: ExpiresInDaysSchema,
  }),
  z.object({
    accept: z.literal(false),
    userCode: UserCodeSchema,
  }),
])

export type DeviceAuthorizeInput = z.infer<typeof DeviceAuthorizeSchema>
export type DeviceAuthorizeAcceptInput = Extract<
  DeviceAuthorizeInput,
  { accept: true }
>
