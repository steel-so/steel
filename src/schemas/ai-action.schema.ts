import { z } from 'zod'

export const AI_ACTION_CONNECTOR_LIMIT = 25
export const AI_ACTION_MAX_PARAMS = 15
export const AI_ACTION_MAX_HEADERS = 10
export const AI_ACTION_MAX_ZAP_TOOLS = 30

export const AiActionConnectorKindSchema = z.enum(['LOOKUP', 'ACTION'])
export const AiActionHttpMethodSchema = z.enum([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])
export const AiActionToolModeSchema = z.enum(['AUTO', 'APPROVAL'])

const FORBIDDEN_HEADERS = new Set([
  'host',
  'content-length',
  'content-type',
  'idempotency-key',
  'transfer-encoding',
  'connection',
])

export const AiActionParamSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Nome de parâmetro inválido'),
  description: z.string().trim().max(300).default(''),
  required: z.boolean().default(true),
})
export type AiActionParam = z.output<typeof AiActionParamSchema>

const HeadersSchema = z
  .record(
    z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/, 'Nome de cabeçalho inválido')
      .refine((name) => !FORBIDDEN_HEADERS.has(name.toLowerCase()), {
        message: 'Este cabeçalho é definido pelo Steel',
      }),
    z.string().trim().min(1).max(1000),
  )
  .refine((headers) => Object.keys(headers).length <= AI_ACTION_MAX_HEADERS, {
    message: `No máximo ${AI_ACTION_MAX_HEADERS} cabeçalhos`,
  })

const connectorFields = {
  key: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9_]{1,47}$/,
      'Use letras minúsculas, números e _ (2 a 48 caracteres)',
    ),
  name: z.string().trim().min(1, 'Informe o nome').max(80),
  description: z
    .string()
    .trim()
    .min(1, 'Explique para a IA quando usar este conector')
    .max(1000),
  kind: AiActionConnectorKindSchema,
  method: AiActionHttpMethodSchema,
  urlTemplate: z.string().trim().min(8).max(500),
  params: z.array(AiActionParamSchema).max(AI_ACTION_MAX_PARAMS),
  enabled: z.boolean(),
}

type ConnectorShape = {
  kind?: 'LOOKUP' | 'ACTION'
  method?: string
  urlTemplate?: string
  params?: { name: string }[]
}

/** Cross-field rules, also re-run by the service on the merged result. */
export function connectorProblem(value: ConnectorShape): string | null {
  if (value.kind === 'LOOKUP' && value.method && value.method !== 'GET') {
    return 'Consultas usam GET. Para alterar dados, escolha o tipo Ação.'
  }
  if (value.kind === 'ACTION' && value.method === 'GET') {
    return 'Ações alteram dados: use POST, PUT, PATCH ou DELETE.'
  }
  if (value.urlTemplate !== undefined) {
    if (!value.urlTemplate.toLowerCase().startsWith('https://')) {
      return 'A URL precisa começar com https://.'
    }
    const afterScheme = value.urlTemplate.slice('https://'.length)
    const authority = afterScheme.split(/[/?#]/, 1)[0] ?? ''
    if (authority.includes('{')) {
      return 'O endereço do servidor não pode ter parâmetros.'
    }
    if (value.params) {
      const declared = new Set(value.params.map((p) => p.name))
      for (const match of value.urlTemplate.matchAll(/\{([^}]*)\}/g)) {
        if (!declared.has(match[1] ?? '')) {
          return `O parâmetro {${match[1]}} da URL não está declarado.`
        }
      }
    }
  }
  if (value.params) {
    const names = value.params.map((p) => p.name)
    if (new Set(names).size !== names.length) return 'Parâmetro repetido.'
  }
  return null
}

export const CreateAiActionConnectorSchema = z
  .object({
    ...connectorFields,
    params: connectorFields.params.default([]),
    enabled: connectorFields.enabled.default(true),
    headers: HeadersSchema.default({}),
  })
  .superRefine((value, ctx) => {
    const problem = connectorProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })
export type CreateAiActionConnectorDTO = z.output<
  typeof CreateAiActionConnectorSchema
>

export const UpdateAiActionConnectorSchema = z
  .object({
    ...connectorFields,
    /** Replaces every header; omit to keep the saved ones. */
    headers: HeadersSchema,
  })
  .omit({ key: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateAiActionConnectorDTO = z.output<
  typeof UpdateAiActionConnectorSchema
>

export const AiActionZapToolSchema = z.object({
  toolName: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/),
  mode: AiActionToolModeSchema.default('APPROVAL'),
})
export type AiActionZapTool = z.output<typeof AiActionZapToolSchema>

export const UpdateAiActionSettingsSchema = z
  .object({
    enabled: z.boolean(),
    zapTools: z
      .array(AiActionZapToolSchema)
      .max(AI_ACTION_MAX_ZAP_TOOLS)
      .refine(
        (tools) =>
          new Set(tools.map((t) => t.toolName)).size === tools.length,
        { message: 'Ferramenta repetida' },
      ),
    zapActorId: z.string().trim().min(1).max(64).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateAiActionSettingsDTO = z.output<
  typeof UpdateAiActionSettingsSchema
>

/** Arguments of the `act_lookup` / `act_run` tools. */
export const AiActionInvokeArgsSchema = z.object({
  connector: z.string().trim().min(1).max(48),
  params: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
})
export type AiActionInvokeArgs = z.output<typeof AiActionInvokeArgsSchema>
