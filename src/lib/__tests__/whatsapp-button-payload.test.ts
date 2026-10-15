import { describe, expect, it } from 'vitest'
import {
  buildButtonPayload,
  parseButtonPayload,
  WHATSAPP_BUTTON_PAYLOAD_MAX,
} from '../whatsapp/button-payload'

describe('button payload', () => {
  it('builds stl:<t|q>:<source>:<button>', () => {
    expect(
      buildButtonPayload({
        sourceType: 'TEMPLATE',
        sourceId: 'tpl1',
        buttonId: 'b1',
      }),
    ).toBe('stl:t:tpl1:b1')
    expect(
      buildButtonPayload({
        sourceType: 'QUICK_REPLY',
        sourceId: 'qr1',
        buttonId: 'x',
      }),
    ).toBe('stl:q:qr1:x')
  })

  it('round-trips both source types', () => {
    for (const sourceType of ['TEMPLATE', 'QUICK_REPLY'] as const) {
      const payload = { sourceType, sourceId: 'abc', buttonId: 'b2' }
      expect(parseButtonPayload(buildButtonPayload(payload))).toEqual(payload)
    }
  })

  it.each([
    [null],
    [undefined],
    [''],
    ['Sim'],
    ['stl:t:abc'],
    ['stl:t:abc:b1:extra'],
    ['xyz:t:abc:b1'],
    ['stl:z:abc:b1'],
    ['stl:t::b1'],
    ['stl:t:abc:'],
    [`stl:t:${'a'.repeat(WHATSAPP_BUTTON_PAYLOAD_MAX)}:b1`],
  ])('ignores a foreign payload %j', (raw) => {
    expect(parseButtonPayload(raw)).toBeNull()
  })
})
