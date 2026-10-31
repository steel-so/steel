import { describe, expect, it } from 'vitest'
import { createWidgetClient } from '../whatsapp/widget-client'

describe('createWidgetClient', () => {
  const client = createWidgetClient()

  it('should mint a widget message id for every kind of send', async () => {
    const results = await Promise.all([
      client.sendText({ to: 'widget:1', text: 'oi' }),
      client.sendMedia({ to: 'widget:1', mediaUrl: 'u', type: 'image' }),
      client.sendTemplate({
        to: 'widget:1',
        templateName: 't',
        language: 'pt_BR',
      }),
      client.sendContact({ to: 'widget:1', name: 'A', waId: '1' }),
      client.sendButtons({ to: 'widget:1', text: 't', buttons: [] }),
    ])
    const ids = results.map((r) => r.providerMessageId)
    expect(ids.every((id) => id.startsWith('widget:out:'))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('should ignore reactions and report the connection as up', async () => {
    await expect(
      client.sendReaction({ to: 'w', providerMessageId: 'x', emoji: '👍' }),
    ).resolves.toBeUndefined()
    await expect(client.getConnectionStatus()).resolves.toEqual({
      connected: true,
    })
  })
})
