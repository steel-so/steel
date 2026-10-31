import { describe, expect, it } from 'vitest'
import { CRM_SALES_AGENT_TEMPLATES } from '@/src/lib/ai/templates/crm-sales-agent-templates'
import { toSteelAgentTemplateDTO } from '@/src/mappers/ai-template.mapper'
import { CreateSteelAgentSchema } from '@/src/schemas/steel-agent.schema'
import { findTool } from '../ai/tools/registry'
import { isValidCron } from '../steel-agents/schedule'
import {
  buildGuidedAgentInput,
  DEFAULT_GUIDED_ANSWERS,
  GUIDED_SCHEDULES,
  guidedAnswersProblems,
  guidedSummary,
} from '../steel-agents/guided'

const dtos = CRM_SALES_AGENT_TEMPLATES.map((template) =>
  toSteelAgentTemplateDTO(template, ['CRM'], findTool),
)
const follow = dtos.find((t) => t.id === 'crm-follow-up-vendas')
const qualify = dtos.find((t) => t.id === 'crm-qualificar-lead')
if (!follow || !qualify) throw new Error('templates missing')

describe('guided schedules', () => {
  it.each(GUIDED_SCHEDULES.map((s) => [s.id, s.cron] as const))(
    '%s should be a valid cron',
    (_id, cron) => {
      expect(isValidCron(cron, 'America/Sao_Paulo')).toBe(true)
    },
  )
})

describe('guidedAnswersProblems', () => {
  const ok = DEFAULT_GUIDED_ANSWERS(follow)

  it('should accept the defaults', () => {
    expect(guidedAnswersProblems(ok)).toEqual([])
  })

  it('should explain every problem in pt-BR', () => {
    expect(guidedAnswersProblems({ ...ok, name: '  ' })).toEqual([
      'Dê um nome ao agente.',
    ])
    expect(
      guidedAnswersProblems({ ...ok, name: 'x'.repeat(121) }).length,
    ).toBe(1)
    expect(
      guidedAnswersProblems({ ...ok, context: 'x'.repeat(1501) }).length,
    ).toBe(1)
    expect(guidedAnswersProblems({ ...ok, monthlyRunCap: 0 }).length).toBe(1)
    expect(guidedAnswersProblems({ ...ok, monthlyRunCap: 1.5 }).length).toBe(1)
    expect(guidedAnswersProblems({ ...ok, monthlyRunCap: 30 })).toEqual([])
  })
})

describe('buildGuidedAgentInput', () => {
  it('should create a paused agent that only suggests by default', () => {
    const input = buildGuidedAgentInput(
      follow,
      DEFAULT_GUIDED_ANSWERS(follow),
      'user1',
    )
    expect(input.enabled).toBe(false)
    expect(input.ownerId).toBe('user1')
    expect(input.cron).toBe(follow.cron)
    expect(input.instructions).toBe(follow.instructions)
    for (const tool of input.tools) {
      const kind = follow.tools.find((t) => t.toolName === tool.toolName)?.kind
      expect(tool.mode).toBe(kind === 'READ' ? 'AUTO' : 'APPROVAL')
    }
  })

  it('should append the company context and apply a chosen schedule', () => {
    const input = buildGuidedAgentInput(
      follow,
      {
        name: ' Follow da Ana ',
        context: ' Nunca prometer desconto. ',
        autonomy: 'SUGGEST',
        scheduleId: 'monday-8',
        monthlyRunCap: 20,
      },
      'user1',
    )
    expect(input.name).toBe('Follow da Ana')
    expect(input.cron).toBe('0 8 * * 1')
    expect(input.monthlyRunCap).toBe(20)
    expect(input.instructions).toContain('Nunca prometer desconto.')
    expect(input.instructions.startsWith(follow.instructions)).toBe(true)
  })

  it('should ignore a schedule for event agents and unknown ids', () => {
    const event = buildGuidedAgentInput(
      qualify,
      { ...DEFAULT_GUIDED_ANSWERS(qualify), scheduleId: 'monday-8' },
      'u',
    )
    expect(event.cron).toBeNull()
    expect(event.eventKey).toBe('crm.lead.created')
    const unknown = buildGuidedAgentInput(
      follow,
      { ...DEFAULT_GUIDED_ANSWERS(follow), scheduleId: 'nope' },
      'u',
    )
    expect(unknown.cron).toBe(follow.cron)
  })

  it('should run only notes and tasks alone when the owner allows it', () => {
    const input = buildGuidedAgentInput(
      qualify,
      { ...DEFAULT_GUIDED_ANSWERS(qualify), autonomy: 'ACT' },
      'u',
    )
    const mode = (name: string) =>
      input.tools.find((t) => t.toolName === name)?.mode
    expect(mode('crm_create_note')).toBe('AUTO')
    expect(mode('crm_create_task')).toBe('AUTO')
    expect(mode('crm_assign_owner')).toBe('APPROVAL')
  })

  it.each(dtos.map((t) => [t.id, t] as const))(
    '%s should pass the create schema in both autonomy modes',
    (_id, template) => {
      for (const autonomy of ['SUGGEST', 'ACT'] as const) {
        const input = buildGuidedAgentInput(
          template,
          { ...DEFAULT_GUIDED_ANSWERS(template), autonomy },
          'ckw1user0000ab7d3k1e5xyz',
        )
        const parsed = CreateSteelAgentSchema.safeParse(input)
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
      }
    },
  )
})

describe('guidedSummary', () => {
  it('should split what runs alone from what waits for approval', () => {
    const summary = guidedSummary(qualify, {
      ...DEFAULT_GUIDED_ANSWERS(qualify),
      autonomy: 'ACT',
    })
    expect(summary.alone).toContain('Criando nota')
    expect(summary.approval.length).toBeGreaterThan(0)
    expect(summary.alone.length + summary.approval.length).toBe(
      qualify.tools.length,
    )
  })
})
