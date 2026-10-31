import { describe, expect, it } from 'vitest'
import {
  buildFlowButtonComponent,
  findTemplateFlowButton,
} from '@/src/lib/whatsapp/flows/template-button'

describe('findTemplateFlowButton', () => {
  it('finds the position and the Meta flow id', () => {
    expect(
      findTemplateFlowButton([
        { type: 'BODY' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL' }, { type: 'FLOW', flow_id: 123 }],
        },
      ]),
    ).toEqual({ index: 1, metaFlowId: '123' })
  })

  it('reports a FLOW button that does not name its flow', () => {
    expect(
      findTemplateFlowButton([
        { type: 'BUTTONS', buttons: [{ type: 'FLOW', flow_id: '' }] },
      ]),
    ).toEqual({ index: 0, metaFlowId: null })
    expect(
      findTemplateFlowButton([
        { type: 'BUTTONS', buttons: [{ type: 'FLOW' }] },
      ]),
    ).toEqual({ index: 0, metaFlowId: null })
  })

  it.each([
    ['not an array', 'oops'],
    ['no BUTTONS block', [{ type: 'BODY' }]],
    ['a block without a list', [{ type: 'BUTTONS' }]],
    ['no FLOW button', [{ type: 'BUTTONS', buttons: [{ type: 'URL' }] }]],
    ['null entries', [null, { type: 'BUTTONS', buttons: [null] }]],
  ])('returns null for %s', (_name, components) => {
    expect(findTemplateFlowButton(components)).toBeNull()
  })
})

describe('buildFlowButtonComponent', () => {
  it('carries the token and, when given, the prefill', () => {
    expect(
      buildFlowButtonComponent({ index: 2, flowToken: 't', data: { a: 'b' } }),
    ).toEqual({
      type: 'button',
      sub_type: 'flow',
      index: '2',
      parameters: [
        {
          type: 'action',
          action: { flow_token: 't', flow_action_data: { a: 'b' } },
        },
      ],
    })
    expect(
      buildFlowButtonComponent({ index: 0, flowToken: 't', data: {} })
        .parameters[0].action,
    ).toEqual({ flow_token: 't' })
    expect(
      buildFlowButtonComponent({ index: 0, flowToken: 't' }).parameters[0]
        .action,
    ).toEqual({ flow_token: 't' })
  })
})
