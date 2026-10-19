import { z } from 'zod'
import { AI_MODEL_KEYS, MAX_MONTHLY_QUOTA_USD } from '@/src/lib/ai/models'

const AiModelKeySchema = z.enum(AI_MODEL_KEYS, {
  error: 'Modelo de IA desconhecido',
})

/**
 * Ajustes de IA do workspace (só OWNER/ADMIN). Todos os campos são
 * opcionais — PATCH parcial. A consistência entre os modelos padrão e a
 * lista de habilitados é validada no service (depende do estado salvo).
 */
export const UpdateWorkspaceAiSettingsSchema = z.object({
  enabledModels: z
    .array(AiModelKeySchema)
    .min(1, 'Habilite ao menos um modelo')
    .refine((keys) => new Set(keys).size === keys.length, {
      message: 'Modelos duplicados',
    })
    .optional(),
  crmAssistantModel: AiModelKeySchema.optional(),
  whatsappReplyModel: AiModelKeySchema.optional(),
  whatsappSentimentModel: AiModelKeySchema.optional(),
  monthlyQuotaUsd: z
    .number()
    .min(0, 'A cota não pode ser negativa')
    .max(MAX_MONTHLY_QUOTA_USD, 'Cota acima do limite permitido')
    .multipleOf(0.01, 'Use no máximo duas casas decimais')
    .optional(),
  /** Steel AI agent mode (write tools). Off = explore only. */
  agentModeEnabled: z.boolean().optional(),
  /** Master switch for every Steel AI feature in the workspace. */
  aiEnabled: z.boolean().optional(),
  /** Steel Agents may run (schedule, events, manual). */
  agentsEnabled: z.boolean().optional(),
  /** Steel AI may save and use memories. */
  memoryEnabled: z.boolean().optional(),
  /** Autopilot mode allowed: writes run without per-action confirmation. */
  autopilotEnabled: z.boolean().optional(),
  /** Weekly Steel AI usage summary e-mailed to the owners. */
  usageWeeklyEmailEnabled: z.boolean().optional(),
  /** External AI clients (MCP) with `mcp:write` may write. */
  mcpWriteEnabled: z.boolean().optional(),
  /** Steel Agents task class model (ADR 0042); null = follow the default. */
  agentModel: AiModelKeySchema.nullable().optional(),
  /** Automatic provider failover (ADR 0042). */
  failoverEnabled: z.boolean().optional(),
  /** Proactive AI: insights feed and daily digest (ADR 0040). */
  proactiveEnabled: z.boolean().optional(),
})

export type UpdateWorkspaceAiSettingsDTO = z.infer<
  typeof UpdateWorkspaceAiSettingsSchema
>

/**
 * Preferência pessoal de modelo (qualquer membro). `null` volta a seguir o
 * padrão do workspace.
 */
export const SetUserAiPreferenceSchema = z.object({
  modelKey: AiModelKeySchema.nullable(),
})

export type SetUserAiPreferenceDTO = z.infer<typeof SetUserAiPreferenceSchema>
