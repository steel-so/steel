import z from 'zod'
import {
  SIMULATION_DEFAULT_PASS_SCORE,
  SIMULATION_DEFAULT_TURNS,
  SIMULATION_MAX_CASES,
  SIMULATION_MAX_CRITERIA,
  SIMULATION_MAX_GENERATED_CASES,
  SIMULATION_MAX_TURNS,
  SIMULATION_MIN_TURNS,
} from '@/src/lib/steel-agents/simulation/limits'
import {
  SIMULATION_CHANNELS,
  SIMULATION_PERSONA_KEYS,
} from '@/src/lib/steel-agents/simulation/personas'

export const SteelAgentSimulationChannelSchema = z.enum(SIMULATION_CHANNELS)

export const SteelAgentSimulationScenarioSchema = z.object({
  label: z.string().trim().min(1, 'Informe o nome do cenário').max(120),
  /** Preset the scenario started from (informational). */
  personaKey: z.enum(SIMULATION_PERSONA_KEYS).nullish(),
  persona: z.string().trim().min(1, 'Descreva a persona').max(1_000),
  scenario: z.string().trim().min(1, 'Descreva o cenário').max(2_000),
  channel: SteelAgentSimulationChannelSchema.default('WHATSAPP'),
  openingMessage: z
    .string()
    .trim()
    .min(1, 'Escreva a primeira mensagem do cliente')
    .max(1_000),
  criteria: z
    .array(z.string().trim().min(1).max(300))
    .min(1, 'Informe ao menos um critério de sucesso')
    .max(SIMULATION_MAX_CRITERIA),
  maxTurns: z
    .number()
    .int()
    .min(SIMULATION_MIN_TURNS)
    .max(SIMULATION_MAX_TURNS)
    .default(SIMULATION_DEFAULT_TURNS),
})
export type SteelAgentSimulationScenarioDTO = z.infer<
  typeof SteelAgentSimulationScenarioSchema
>

export const CreateSteelAgentSimulationSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** Minimum judge score for a case to pass. */
  passScore: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(SIMULATION_DEFAULT_PASS_SCORE),
  scenarios: z
    .array(SteelAgentSimulationScenarioSchema)
    .min(1, 'Adicione ao menos um cenário')
    .max(SIMULATION_MAX_CASES),
})
export type CreateSteelAgentSimulationDTO = z.infer<
  typeof CreateSteelAgentSimulationSchema
>

export const GenerateSteelAgentScenariosSchema = z.object({
  count: z.number().int().min(1).max(SIMULATION_MAX_GENERATED_CASES).default(3),
  focus: z.string().trim().max(500).optional(),
})
export type GenerateSteelAgentScenariosDTO = z.infer<
  typeof GenerateSteelAgentScenariosSchema
>

export const ListSteelAgentSimulationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListSteelAgentSimulationsQueryDTO = z.infer<
  typeof ListSteelAgentSimulationsQuerySchema
>
