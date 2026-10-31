import { describe, expect, it } from 'vitest'
import {
  CRM_SALES_AGENT_TEMPLATES,
  findCrmSalesAgentTemplate,
} from '@/src/lib/ai/templates/crm-sales-agent-templates'
import { STEEL_AGENT_TEMPLATES } from '@/src/lib/ai/templates/agent-templates'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { CreateSteelAgentSchema } from '@/src/schemas/steel-agent.schema'
import { isValidCron, isValidTimeZone } from '@/src/lib/steel-agents/schedule'
import { steelAgentEvent } from '@/src/lib/steel-agents/events'

const toolByName = new Map(STEEL_AI_TOOLS.map((tool) => [tool.name, tool]))

describe('CRM sales agent templates (C3)', () => {
  it('should offer qualify, follow-up and update-opportunity agents', () => {
    expect(CRM_SALES_AGENT_TEMPLATES.map((t) => t.id)).toEqual([
      'crm-qualificar-lead',
      'crm-follow-up-vendas',
      'crm-atualizar-oportunidade',
    ])
    expect(findCrmSalesAgentTemplate('crm-follow-up-vendas')?.name).toBe(
      'Follow-up de vendas',
    )
    expect(findCrmSalesAgentTemplate('nope')).toBeUndefined()
  })

  it('should not reuse an id of the admin catalog', () => {
    const taken = new Set(STEEL_AGENT_TEMPLATES.map((t) => t.id))
    for (const template of CRM_SALES_AGENT_TEMPLATES) {
      expect(taken.has(template.id)).toBe(false)
    }
  })

  it.each(CRM_SALES_AGENT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s should use real CRM tools and never write on its own',
    (_id, template) => {
      expect(template.modules).toEqual(['CRM'])
      for (const spec of template.tools) {
        const tool = toolByName.get(spec.toolName)
        expect(tool, spec.toolName).toBeDefined()
        // Platform tools (ws_members) have no module.
        if (tool?.module) expect(tool.module).toBe('CRM')
        expect(spec.mode).toBe(tool?.kind === 'READ' ? 'AUTO' : 'APPROVAL')
      }
    },
  )

  it.each(CRM_SALES_AGENT_TEMPLATES.map((t) => [t.id, t] as const))(
    '%s should have a valid trigger and pass the create schema',
    (_id, template) => {
      expect(isValidTimeZone(template.timezone)).toBe(true)
      if (template.triggerType === 'EVENT') {
        expect(steelAgentEvent(template.eventKey ?? '')?.module).toBe('CRM')
        expect(template.cron).toBeNull()
      } else {
        expect(isValidCron(template.cron ?? '', template.timezone)).toBe(true)
      }
      const parsed = CreateSteelAgentSchema.safeParse({
        name: template.name,
        description: template.description,
        instructions: template.instructions,
        triggerType: template.triggerType,
        cron: template.cron,
        eventKey: template.eventKey ?? null,
        timezone: template.timezone,
        enabled: false,
        ownerId: 'ckw1user0000ab7d3k1e5xyz',
        maxToolRounds: template.maxToolRounds,
        tools: template.tools,
      })
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    },
  )
})
