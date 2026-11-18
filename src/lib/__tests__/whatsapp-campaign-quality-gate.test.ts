import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

const { numberQuality } = vi.hoisted(() => ({ numberQuality: vi.fn() }))
vi.mock('@/src/lib/whatsapp/meta-number-quality', () => ({
  metaNumberQualityOf: numberQuality,
}))

import { assertCampaignSendAllowed } from '@/src/lib/whatsapp/campaign-quality-gate'
import { isQualityBlockReason } from '@/src/lib/whatsapp/quality-block'

const connection = createFakeWhatsAppConnection({ provider: 'META' })
const template = { name: 'cobranca', quality: 'GREEN' as const }

describe('assertCampaignSendAllowed', () => {
  beforeEach(() => {
    numberQuality.mockReset()
    numberQuality.mockResolvedValue('GREEN')
  })

  it('blocks a RED number and says it is the number', async () => {
    numberQuality.mockResolvedValue('RED')

    const error = expectErr(
      await assertCampaignSendAllowed(connection, template),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(error.message).toContain('o número desta conexão')
    expect(isQualityBlockReason(error.message)).toBe(true)
  })

  it('blocks a RED template and names it', async () => {
    const error = expectErr(
      await assertCampaignSendAllowed(connection, {
        ...template,
        quality: 'RED',
      }),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(error.message).toContain('o template "cobranca"')
  })

  it('reports the number first when both are RED', async () => {
    numberQuality.mockResolvedValue('RED')

    const error = expectErr(
      await assertCampaignSendAllowed(connection, {
        ...template,
        quality: 'RED',
      }),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(error.message).toContain('o número desta conexão')
  })

  it.each([
    ['GREEN', 'GREEN'],
    ['YELLOW', 'YELLOW'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)(
    'allows a %s number with a %s template',
    async (numberRating, templateRating) => {
      numberQuality.mockResolvedValue(numberRating)

      expectOk(
        await assertCampaignSendAllowed(connection, {
          ...template,
          quality: templateRating,
        }),
      )
    },
  )

  it('fails open when the lookup cannot be made (UNKNOWN)', async () => {
    numberQuality.mockResolvedValue('UNKNOWN')

    expectOk(await assertCampaignSendAllowed(connection, template))
  })

  it.each([
    ['BROADCAST', 'as transmissões ficam bloqueadas'],
    ['NEWSLETTER', 'o envio da newsletter no WhatsApp fica bloqueado'],
    ['CRM_CAMPAIGN', 'as campanhas do CRM com WhatsApp ficam bloqueadas'],
  ] as const)('words the %s refusal for that sender', async (sender, text) => {
    numberQuality.mockResolvedValue('RED')

    const error = expectErr(
      await assertCampaignSendAllowed(connection, template, sender),
      'WHATSAPP_QUALITY_BLOCKED',
    )
    expect(error.message).toContain(text)
    expect(isQualityBlockReason(error.message)).toBe(true)
  })

  it('does not take other pause reasons for a quality block', () => {
    expect(isQualityBlockReason('Limite de gasto atingido')).toBe(false)
    expect(isQualityBlockReason(null)).toBe(false)
  })
})
