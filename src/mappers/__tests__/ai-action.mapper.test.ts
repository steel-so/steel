import { describe, expect, it } from 'vitest'
import {
  createFakeAiActionConnector,
  createFakeAiActionSettings,
} from '@/src/__tests__/factories/nov-ai-actions.factory'
import {
  connectorParamsOf,
  toAiActionConnectorDTO,
  toAiActionSettingsDTO,
  zapToolsOf,
} from '../ai-action.mapper'

describe('ai-action mapper', () => {
  it('should map a connector without the header values', () => {
    const connector = createFakeAiActionConnector({
      encryptedHeaders: 'secret',
    })
    const dto = toAiActionConnectorDTO(connector, ['Authorization'])
    expect(dto.headerNames).toEqual(['Authorization'])
    expect(JSON.stringify(dto)).not.toContain('secret')
    expect(dto.params).toEqual([
      { name: 'orderId', description: 'Número', required: true },
    ])
    expect(dto.createdAt).toBe('2026-10-30T12:00:00.000Z')
  })

  it('should read params defensively', () => {
    expect(connectorParamsOf('nope')).toEqual([])
    expect(
      connectorParamsOf([
        null,
        { description: 'no name' },
        { name: 'a' },
        { name: 'b', description: 'd', required: false },
      ]),
    ).toEqual([
      { name: 'a', description: '', required: true },
      { name: 'b', description: 'd', required: false },
    ])
  })

  it('should read the allow-list defensively', () => {
    expect(zapToolsOf(undefined)).toEqual([])
    expect(
      zapToolsOf([
        'x',
        { mode: 'AUTO' },
        { toolName: 'a', mode: 'AUTO' },
        { toolName: 'b', mode: 'weird' },
      ]),
    ).toEqual([
      { toolName: 'a', mode: 'AUTO' },
      { toolName: 'b', mode: 'APPROVAL' },
    ])
  })

  it('should default the settings when the workspace has none', () => {
    expect(toAiActionSettingsDTO(null)).toEqual({
      enabled: false,
      zapTools: [],
      zapActorId: null,
    })
    expect(
      toAiActionSettingsDTO(
        createFakeAiActionSettings({
          zapTools: [{ toolName: 'act_run', mode: 'AUTO' }],
          zapActorId: 'u1',
        }),
      ),
    ).toEqual({
      enabled: true,
      zapTools: [{ toolName: 'act_run', mode: 'AUTO' }],
      zapActorId: 'u1',
    })
  })
})
