import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppWidgetSettings } from '@/src/__tests__/factories/nov-site-widget.factory'
import {
  toWhatsAppWidgetSettingsDTO,
  toWidgetMessageDTO,
  toWidgetPublicConfigDTO,
  toWidgetSurveyDTO,
} from '../whatsapp-widget.mapper'

const BASE = 'https://steel.example.com'

describe('toWhatsAppWidgetSettingsDTO', () => {
  it('should return the defaults and no snippet when never saved', () => {
    const dto = toWhatsAppWidgetSettingsDTO('ws1', null, BASE)
    expect(dto.enabled).toBe(false)
    expect(dto.publicKey).toBe('')
    expect(dto.snippet).toBe('')
    expect(dto.allowedOrigins).toEqual([])
    expect(dto.position).toBe('RIGHT')
    expect(dto.teamId).toBeNull()
    expect(dto.portalUrl).toBe(`${BASE}/suporte`)
  })

  it('should map a saved row with the snippet', () => {
    const row = createFakeWhatsAppWidgetSettings({
      workspaceId: 'ws1',
      publicKey: 'stw_abc',
      position: 'LEFT',
      teamId: 't1',
      preChatEnabled: true,
    })
    const dto = toWhatsAppWidgetSettingsDTO('ws1', row, BASE)
    expect(dto.enabled).toBe(true)
    expect(dto.position).toBe('LEFT')
    expect(dto.teamId).toBe('t1')
    expect(dto.preChatEnabled).toBe(true)
    expect(dto.snippet).toContain('data-key="stw_abc"')
    expect(dto.snippet).toContain(`${BASE}/steel-widget.js`)
  })

  it('should fall back to RIGHT for an unknown position', () => {
    const row = createFakeWhatsAppWidgetSettings({ position: 'WEIRD' })
    expect(toWhatsAppWidgetSettingsDTO('ws', row, BASE).position).toBe('RIGHT')
  })
})

describe('toWidgetPublicConfigDTO', () => {
  it('should hide the offline notice while online', () => {
    const row = createFakeWhatsAppWidgetSettings()
    expect(toWidgetPublicConfigDTO(row, true, BASE).offlineMessage).toBeNull()
  })

  it('should show the offline notice when offline and enabled', () => {
    const row = createFakeWhatsAppWidgetSettings({ offlineMessage: 'Fechado' })
    expect(toWidgetPublicConfigDTO(row, false, BASE).offlineMessage).toBe(
      'Fechado',
    )
  })

  it('should omit the notice when it is turned off', () => {
    const row = createFakeWhatsAppWidgetSettings({ offlineEnabled: false })
    expect(toWidgetPublicConfigDTO(row, false, BASE).offlineMessage).toBeNull()
  })

  it('should expose the portal link only when on', () => {
    const off = createFakeWhatsAppWidgetSettings({ showPortal: false })
    const on = createFakeWhatsAppWidgetSettings({ showPortal: true })
    expect(toWidgetPublicConfigDTO(off, true, BASE).portalUrl).toBeNull()
    expect(toWidgetPublicConfigDTO(on, true, BASE).portalUrl).toBe(
      `${BASE}/suporte`,
    )
  })

  it('should not leak admin-only fields', () => {
    const dto = toWidgetPublicConfigDTO(
      createFakeWhatsAppWidgetSettings(),
      true,
      BASE,
    )
    expect(dto).not.toHaveProperty('publicKey')
    expect(dto).not.toHaveProperty('allowedOrigins')
    expect(dto).not.toHaveProperty('teamId')
  })
})

describe('toWidgetMessageDTO', () => {
  const at = new Date('2026-10-30T12:00:00Z')
  const base = {
    id: 'm1',
    type: 'TEXT',
    text: 'Oi',
    mediaUrl: null,
    sentByAi: false,
    senderUserId: null,
    createdAt: at,
  } as const

  it('should label the author', () => {
    expect(toWidgetMessageDTO({ ...base, direction: 'IN' }).from).toBe(
      'visitor',
    )
    expect(toWidgetMessageDTO({ ...base, direction: 'OUT' }).from).toBe('agent')
    expect(
      toWidgetMessageDTO({ ...base, direction: 'OUT', sentByAi: true }).from,
    ).toBe('ai')
  })

  it('should use a placeholder for messages without text', () => {
    const image = toWidgetMessageDTO({
      ...base,
      direction: 'OUT',
      type: 'IMAGE',
      text: null,
    })
    expect(image.text).toBe('Enviou uma imagem')
    const other = toWidgetMessageDTO({
      ...base,
      direction: 'OUT',
      type: 'TEMPLATE',
      text: '  ',
    })
    expect(other.text).toBe('Mensagem')
    expect(other.createdAt).toBe(at.toISOString())
  })
})

describe('toWidgetSurveyDTO', () => {
  it('should carry the scale of the kind', () => {
    expect(toWidgetSurveyDTO('NPS')).toMatchObject({
      kind: 'NPS',
      scaleMin: 0,
      scaleMax: 10,
    })
    expect(toWidgetSurveyDTO('CSAT')).toMatchObject({
      scaleMin: 1,
      scaleMax: 5,
    })
  })
})
