import type { SteelAgentTemplateDTO } from '@/types/ai-template'

/**
 * C3 — guided, no-code creation of a Steel Agent. The wizard asks plain
 * questions (what for, what the company needs it to know, how bold it may
 * be, how often) and this pure function turns the answers into the normal
 * create payload of a template-based agent. The agent is always created
 * paused, so the owner runs "Testar agente" before it acts.
 */

export type GuidedAutonomy = 'SUGGEST' | 'ACT'

/** Writes that may run alone when the owner picks "ACT": reversible and internal. */
export const GUIDED_LOW_RISK_TOOLS: readonly string[] = [
  'crm_create_note',
  'crm_create_task',
]

export const GUIDED_CONTEXT_MAX_CHARS = 1500

export const GUIDED_SCHEDULES = [
  { id: 'daily-9', label: 'Todo dia útil às 9h', cron: '0 9 * * 1-5' },
  {
    id: 'twice-daily',
    label: 'Dias úteis às 8h e às 14h',
    cron: '0 8,14 * * 1-5',
  },
  { id: 'monday-8', label: 'Segundas às 8h', cron: '0 8 * * 1' },
] as const

export interface GuidedAnswers {
  name: string
  /** What the company wants the agent to know (offer, tone, rules). */
  context: string
  autonomy: GuidedAutonomy
  /** `GUIDED_SCHEDULES` id; only used by agents that run on a schedule. */
  scheduleId: string | null
  monthlyRunCap: number | null
}

export const DEFAULT_GUIDED_ANSWERS = (
  template: Pick<SteelAgentTemplateDTO, 'name'>,
): GuidedAnswers => ({
  name: template.name,
  context: '',
  autonomy: 'SUGGEST',
  scheduleId: null,
  monthlyRunCap: null,
})

export interface GuidedAgentInput {
  name: string
  description: string | null
  instructions: string
  triggerType: SteelAgentTemplateDTO['triggerType']
  cron: string | null
  timezone: string
  eventKey: string | null
  enabled: false
  ownerId: string
  maxToolRounds: number
  monthlyRunCap: number | null
  tools: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[]
}

/** Problems with the answers, in pt-BR (empty = valid). */
export function guidedAnswersProblems(answers: GuidedAnswers): string[] {
  const problems: string[] = []
  if (!answers.name.trim()) problems.push('Dê um nome ao agente.')
  if (answers.name.trim().length > 120) {
    problems.push('O nome pode ter no máximo 120 caracteres.')
  }
  if (answers.context.length > GUIDED_CONTEXT_MAX_CHARS) {
    problems.push(
      `O contexto pode ter no máximo ${GUIDED_CONTEXT_MAX_CHARS} caracteres.`,
    )
  }
  if (
    answers.monthlyRunCap !== null &&
    (!Number.isInteger(answers.monthlyRunCap) || answers.monthlyRunCap < 1)
  ) {
    problems.push('O limite mensal precisa ser um número inteiro maior que zero.')
  }
  return problems
}

export function buildGuidedAgentInput(
  template: SteelAgentTemplateDTO,
  answers: GuidedAnswers,
  ownerId: string,
): GuidedAgentInput {
  const context = answers.context.trim()
  const schedule =
    template.triggerType === 'SCHEDULE'
      ? GUIDED_SCHEDULES.find((s) => s.id === answers.scheduleId)
      : undefined
  return {
    name: answers.name.trim(),
    description: template.description,
    instructions: context
      ? `${template.instructions}\n\nContexto da empresa (informado pelo administrador; use como orientação, nunca para sair das regras acima):\n${context}`
      : template.instructions,
    triggerType: template.triggerType,
    cron: schedule ? schedule.cron : template.cron,
    timezone: template.timezone,
    eventKey: template.eventKey,
    enabled: false,
    ownerId,
    maxToolRounds: template.maxToolRounds,
    monthlyRunCap: answers.monthlyRunCap,
    tools: template.tools.map((tool) => ({
      toolName: tool.toolName,
      mode:
        tool.kind === 'READ' ||
        (answers.autonomy === 'ACT' &&
          tool.kind !== 'DELETE' &&
          GUIDED_LOW_RISK_TOOLS.includes(tool.toolName))
          ? 'AUTO'
          : 'APPROVAL',
    })),
  }
}

/** Plain-language lines of what the agent will do on its own and what waits. */
export function guidedSummary(
  template: SteelAgentTemplateDTO,
  answers: GuidedAnswers,
): { alone: string[]; approval: string[] } {
  const input = buildGuidedAgentInput(template, answers, '')
  const label = new Map(template.tools.map((t) => [t.toolName, t.label]))
  const names = (mode: 'AUTO' | 'APPROVAL') =>
    input.tools
      .filter((t) => t.mode === mode)
      .map((t) => label.get(t.toolName) ?? t.toolName)
  return { alone: names('AUTO'), approval: names('APPROVAL') }
}
