import { describe, expect, it } from 'vitest'
import {
  isWaDashboardSource,
  pickWaTvRows,
  waTvSafeKeys,
} from '@/src/lib/whatsapp/dashboard-tv-rows'
import { WA_DASHBOARD_SOURCES } from '@/src/schemas/whatsapp-dashboard.schema'

describe('whatsapp dashboard TV rows', () => {
  it('has an allowlist with id for each of the 18 sources', () => {
    expect(WA_DASHBOARD_SOURCES).toHaveLength(18)
    for (const source of WA_DASHBOARD_SOURCES) {
      const keys = waTvSafeKeys(source)
      expect(keys.has('id')).toBe(true)
      expect(keys.size).toBeGreaterThan(3)
    }
  })

  it('keeps hasWhatsapp, which a name pattern would drop', () => {
    expect(
      pickWaTvRows('whatsapp-contacts', [
        { id: 'c1', hasWhatsapp: 'Sim', name: 'Maria', phone: '5511' },
      ]),
    ).toEqual([{ id: 'c1', hasWhatsapp: 'Sim' }])
  })

  it('drops the free text an attendant types', () => {
    expect(waTvSafeKeys('whatsapp-attendances').has('closeReason')).toBe(false)
    expect(waTvSafeKeys('whatsapp-attendances').has('contactName')).toBe(false)
    expect(waTvSafeKeys('whatsapp-attendances').has('contactPhone')).toBe(false)
    expect(waTvSafeKeys('whatsapp-attendances').has('closeStatus')).toBe(true)
    expect(waTvSafeKeys('whatsapp-conversation-events').has('reason')).toBe(
      false,
    )
    expect(
      pickWaTvRows('whatsapp-conversation-events', [
        { id: 'e1', kind: 'Encerrada', reason: 'Cliente João', team: 'A' },
      ]),
    ).toEqual([{ id: 'e1', kind: 'Encerrada', team: 'A' }])
  })

  it('drops keys the source does not document', () => {
    expect(
      pickWaTvRows('whatsapp-messages', [
        { id: 'm1', direction: 'Recebida', body: 'oi', waId: '55' },
      ]),
    ).toEqual([{ id: 'm1', direction: 'Recebida' }])
  })

  it('recognises only the 18 flattened sources', () => {
    expect(isWaDashboardSource('whatsapp-calls')).toBe(true)
    expect(isWaDashboardSource('whatsapp-conversations')).toBe(false)
    expect(isWaDashboardSource('whatsapp-broadcasts')).toBe(false)
    expect(isWaDashboardSource('leads')).toBe(false)
  })
})
