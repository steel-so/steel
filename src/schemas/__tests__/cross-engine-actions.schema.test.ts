import { describe, expect, it } from 'vitest'
import {
  CRM_WORKFLOW_NODE_TYPES,
  CrmWorkflowNodeDataSchema,
} from '../crm-workflow.schema'
import {
  SD_WHATSAPP_VARIABLES,
  SdAutomationActionsSchema,
} from '../sd-rule.schema'
import { ChatbotNodeSchema } from '../whatsapp-chatbot.schema'

const pos = { x: 0, y: 0 }

describe('CRM workflow cross-engine nodes', () => {
  it('lists the new node types', () => {
    expect(CRM_WORKFLOW_NODE_TYPES).toContain('send-whatsapp-template')
    expect(CRM_WORKFLOW_NODE_TYPES).toContain('create-ticket')
  })

  it('parses send-whatsapp-template and applies defaults', () => {
    const parsed = CrmWorkflowNodeDataSchema.parse({
      type: 'send-whatsapp-template',
      connectionId: 'c1',
      to: '{{trigger.record.phone}}',
    })
    expect(parsed).toMatchObject({ variables: [], to: expect.any(String) })
    expect(
      CrmWorkflowNodeDataSchema.safeParse({
        type: 'send-whatsapp-template',
        connectionId: '',
        to: 'x',
      }).success,
    ).toBe(false)
  })

  it('parses create-ticket with the INCIDENT default and validates the type', () => {
    const parsed = CrmWorkflowNodeDataSchema.parse({
      type: 'create-ticket',
      title: 'Lead {{trigger.record.id}}',
    })
    expect(parsed).toMatchObject({ ticketType: 'INCIDENT' })
    expect(
      CrmWorkflowNodeDataSchema.safeParse({
        type: 'create-ticket',
        title: '',
      }).success,
    ).toBe(false)
    expect(
      CrmWorkflowNodeDataSchema.safeParse({
        type: 'create-ticket',
        title: 'x',
        ticketType: 'NOPE',
      }).success,
    ).toBe(false)
  })
})

describe('ServiceDesk automation cross-engine actions', () => {
  it('parses the three new actions', () => {
    const parsed = SdAutomationActionsSchema.parse([
      {
        type: 'send_whatsapp_template',
        params: { connectionId: 'c1', variables: ['code', 'phase'] },
      },
      { type: 'create_crm_task', params: { title: 'Ligar' } },
      { type: 'create_crm_lead', params: {} },
    ])
    expect(parsed[2]).toEqual({
      type: 'create_crm_lead',
      params: { origin: 'ServiceDesk' },
    })
    expect(SD_WHATSAPP_VARIABLES).toEqual([
      'code',
      'title',
      'requester',
      'phase',
    ])
  })

  it('rejects unknown variables and a missing connection', () => {
    expect(
      SdAutomationActionsSchema.safeParse([
        {
          type: 'send_whatsapp_template',
          params: { connectionId: 'c1', variables: ['secret'] },
        },
      ]).success,
    ).toBe(false)
    expect(
      SdAutomationActionsSchema.safeParse([
        { type: 'send_whatsapp_template', params: { variables: [] } },
      ]).success,
    ).toBe(false)
  })
})

describe('chatbot cross-engine nodes', () => {
  it('parses create-lead and open-ticket', () => {
    expect(
      ChatbotNodeSchema.safeParse({
        id: 'lead',
        type: 'create-lead',
        position: pos,
        data: {
          name: '{{contact_name}}',
          phone: '{{contact_phone}}',
          origin: 'Bot',
          resultVariable: 'lead_id',
        },
      }).success,
    ).toBe(true)
    expect(
      ChatbotNodeSchema.safeParse({
        id: 'ticket',
        type: 'open-ticket',
        position: pos,
        data: { ticketType: 'PROBLEM', title: 'Falha' },
      }).success,
    ).toBe(true)
  })

  it('rejects a reserved result variable and an empty title', () => {
    expect(
      ChatbotNodeSchema.safeParse({
        id: 'ticket',
        type: 'open-ticket',
        position: pos,
        data: {
          ticketType: 'INCIDENT',
          title: 'x',
          resultVariable: 'contact_phone',
        },
      }).success,
    ).toBe(false)
    expect(
      ChatbotNodeSchema.safeParse({
        id: 'ticket',
        type: 'open-ticket',
        position: pos,
        data: { ticketType: 'INCIDENT', title: '' },
      }).success,
    ).toBe(false)
  })
})
