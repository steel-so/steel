import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WhatsappAdReferralBanner } from '../whatsapp-ad-referral-banner'

const referral = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('@/src/hooks/use-whatsapp-ads', () => ({
  useWhatsAppConversationAdReferral: () => ({ data: referral.data }),
}))

const base = {
  id: 'r1',
  conversationId: 'c1',
  sourceType: 'ad',
  sourceId: '123',
  sourceUrl: 'https://fb.me/ad',
  headline: 'Promoção de verão',
  body: 'Fale com a gente',
  mediaType: null,
  mediaUrl: null,
  leadId: null,
  receivedAt: '2026-10-10T15:00:00.000Z',
}

function renderBanner() {
  return render(
    <WhatsappAdReferralBanner workspaceId='w1' conversationId='c1' />,
  )
}

describe('WhatsappAdReferralBanner', () => {
  beforeEach(() => {
    referral.data = null
  })

  it('renders nothing for an ordinary conversation', () => {
    const { container } = renderBanner()
    expect(container.innerHTML).toBe('')
  })

  it('names the ad, its text and links to it', () => {
    referral.data = base
    renderBanner()
    expect(
      screen.getByText(/Veio de um anúncio: Promoção de verão/),
    ).toBeTruthy()
    expect(screen.getByText('Fale com a gente')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Abrir anúncio' }).getAttribute('href'),
    ).toBe('https://fb.me/ad')
  })

  it('falls back to the ad id and says post for a publication', () => {
    referral.data = {
      ...base,
      sourceType: 'post',
      headline: null,
      body: null,
    }
    renderBanner()
    expect(screen.getByText(/Veio de uma publicação: Anúncio 123/)).toBeTruthy()
  })

  it('never links a non-http URL', () => {
    referral.data = { ...base, sourceUrl: 'javascript:alert(1)' }
    renderBanner()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
