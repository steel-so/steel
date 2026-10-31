import z from 'zod'
import { CreateSdAutomationRuleSchema } from './sd-automation-rule.schema'
import { sdId } from './sd-config.schema'
import { CreateSdEscalationRuleSchema } from './sd-escalation-rule.schema'
import { CreateSdSlaPolicySchema } from './sd-sla-policy.schema'

/**
 * S8 — configuração em linguagem natural. O admin descreve uma política de
 * SLA, uma regra de automação ou de escalonamento; a IA devolve a
 * configuração, o servidor valida com os mesmos schemas de criação e mostra
 * a prévia. Nada é salvo até o `apply` explícito.
 */

export const SD_NL_CONFIG_KINDS = ['SLA', 'AUTOMATION', 'ESCALATION'] as const
export const SdNlConfigKindEnum = z.enum(SD_NL_CONFIG_KINDS)
export type SdNlConfigKind = z.infer<typeof SdNlConfigKindEnum>

export const SdNlConfigPreviewSchema = z.object({
  kind: SdNlConfigKindEnum,
  text: z.string().trim().min(5, 'Descreva o que você precisa').max(2000),
  /** Regra existente a ajustar; sem ela, a prévia é de uma regra nova. */
  targetId: sdId.optional(),
})
export type SdNlConfigPreviewDTO = z.infer<typeof SdNlConfigPreviewSchema>

/** O `config` é revalidado no servidor com o schema de criação do tipo. */
export const SdNlConfigApplySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('SLA'),
    targetId: sdId.optional(),
    config: CreateSdSlaPolicySchema,
  }),
  z.object({
    kind: z.literal('AUTOMATION'),
    targetId: sdId.optional(),
    config: CreateSdAutomationRuleSchema,
  }),
  z.object({
    kind: z.literal('ESCALATION'),
    targetId: sdId.optional(),
    config: CreateSdEscalationRuleSchema,
  }),
])
export type SdNlConfigApplyDTO = z.infer<typeof SdNlConfigApplySchema>

/**
 * Saída do modelo. A configuração viaja como texto JSON dentro do envelope
 * (o modo estrito do provedor não aceita a união de ações); o servidor
 * faz o parse e valida com o schema de criação.
 */
export const SdNlConfigModelOutputSchema = z.object({
  understood: z.boolean(),
  summary: z.string().max(1000),
  warnings: z.array(z.string().max(500)).max(20),
  configJson: z.string().max(30_000),
})
export type SdNlConfigModelOutput = z.infer<typeof SdNlConfigModelOutputSchema>

export const SD_NL_CONFIG_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'summary', 'warnings', 'configJson'],
  properties: {
    understood: { type: 'boolean' },
    summary: { type: 'string' },
    warnings: { type: 'array', items: { type: 'string' } },
    configJson: { type: 'string' },
  },
}
