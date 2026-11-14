import { describe, expect, it } from 'vitest'
import type { SdTicketEventDTO } from '@/types/sd-ticket'
import { sdDescribeEvent } from '../sd-ticket-events'

function event(overrides: Partial<SdTicketEventDTO>): SdTicketEventDTO {
  return {
    id: 'e1',
    ticketId: 't1',
    actorKind: 'SYSTEM',
    actor: null,
    action: 'automation.applied',
    field: null,
    fromValue: null,
    toValue: null,
    meta: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    ...overrides,
  }
}

describe('sdDescribeEvent()', () => {
  it('should keep describing an applied automation with its rule name', () => {
    const described = sdDescribeEvent(
      event({ meta: { ruleName: 'Avisar o cliente' } }),
    )
    expect(described.title).toBe('automação aplicada')
    expect(described.detail).toBe('Avisar o cliente')
  })

  it('should say a skipped automation step was skipped and why', () => {
    const described = sdDescribeEvent(
      event({
        action: 'automation.skipped',
        toValue: 'O contato não tem telefone',
        meta: { ruleName: 'Avisar o cliente' },
      }),
    )
    expect(described.title).toBe('automação pulou uma etapa')
    expect(described.detail).toBe(
      'Avisar o cliente: O contato não tem telefone',
    )
  })

  it('should describe a failed automation', () => {
    expect(sdDescribeEvent(event({ action: 'automation.failed' })).title).toBe(
      'automação falhou',
    )
  })

  it.each([
    ['crm_task.created', 'criou uma tarefa no CRM'],
    ['crm_lead.created', 'criou um lead no CRM'],
    ['crm_lead.reused', 'reaproveitou um lead do CRM'],
    ['whatsapp.linked', 'vinculou a conversa do WhatsApp'],
    ['crm.linked', 'vinculou o chamado ao CRM'],
  ])('should write %s in plain pt-BR', (action, title) => {
    expect(sdDescribeEvent(event({ action })).title).toBe(title)
  })
})
