import { describe, expect, it } from 'vitest'
import {
  parseAiCampaignActions,
  parseAiCampaignActionsDetailed,
} from '../whatsapp-ai-campaign.mapper'

const close = {
  id: 'a1',
  kind: 'CLOSE',
  label: 'Fechar',
  when: 'Quando o cliente disser que não tem interesse',
  statusIds: [],
}
const transfer = {
  id: 'a2',
  kind: 'TRANSFER_TEAM',
  label: 'Equipe',
  when: 'Quando pedir um humano',
  teamId: 't1',
}

describe('parseAiCampaignActions', () => {
  it('keeps every valid action', () => {
    const result = parseAiCampaignActionsDetailed([close, transfer])
    expect(result.invalid).toBe(0)
    expect(result.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('drops only the invalid action, not the whole list', () => {
    const broken = { ...transfer, id: 'a3', teamId: '' }
    const result = parseAiCampaignActionsDetailed([close, broken, transfer])
    expect(result.invalid).toBe(1)
    expect(result.actions.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('drops an action of an unknown kind', () => {
    const result = parseAiCampaignActionsDetailed([
      { ...close, id: 'a9', kind: 'TELEPORT' },
      close,
    ])
    expect(result.invalid).toBe(1)
    expect(result.actions.map((a) => a.id)).toEqual(['a1'])
  })

  it('keeps the first of a repeated id', () => {
    const result = parseAiCampaignActionsDetailed([
      close,
      { ...transfer, id: 'a1' },
    ])
    expect(result.invalid).toBe(1)
    expect(result.actions[0]?.kind).toBe('CLOSE')
  })

  it.each([null, undefined, {}, 'x', 3])('reads %j as no actions', (raw) => {
    expect(parseAiCampaignActionsDetailed(raw)).toEqual({
      actions: [],
      invalid: 0,
    })
    expect(parseAiCampaignActions(raw)).toEqual([])
  })
})
