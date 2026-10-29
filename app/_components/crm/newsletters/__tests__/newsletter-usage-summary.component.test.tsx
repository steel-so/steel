import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import { NewsletterSenderBadge } from '../newsletter-sender-badge'
import { NewsletterUsageSummary } from '../newsletter-usage-summary'

function setup(data: { emailsSent: number; limit: number | null }) {
  mockFetch([
    {
      match: '/crm/newsletter-usage',
      data: { month: '2026-10', limitSource: 'PLAN', ...data },
    },
  ])
  renderWithQuery(<NewsletterUsageSummary workspaceId='ws1' />)
}

describe('<NewsletterUsageSummary />', () => {
  it('shows "X de Y e-mails usados neste mês"', async () => {
    setup({ emailsSent: 1200, limit: 3000 })
    await waitFor(() =>
      expect(
        screen.getByText(/de 3\.000 e-mails usados neste mês/),
      ).toBeTruthy(),
    )
    expect(screen.getByText('1.200')).toBeTruthy()
    expect(screen.queryByText(/perto do limite|limite atingido/)).toBeNull()
  })

  it('flags near and reached limits', async () => {
    setup({ emailsSent: 2500, limit: 3000 })
    await waitFor(() =>
      expect(screen.getByText(/perto do limite/)).toBeTruthy(),
    )
  })

  it('says when the limit is reached', async () => {
    setup({ emailsSent: 3000, limit: 3000 })
    await waitFor(() =>
      expect(screen.getByText(/limite atingido/)).toBeTruthy(),
    )
  })

  it('handles the unlimited plan', async () => {
    setup({ emailsSent: 1, limit: null })
    await waitFor(() =>
      expect(screen.getByText(/e-mail enviado neste mês/)).toBeTruthy(),
    )
    expect(screen.getByText(/sem limite/)).toBeTruthy()
  })

  it('renders nothing on error', async () => {
    mockFetch([])
    const { container } = renderWithQuery(
      <NewsletterUsageSummary workspaceId='ws1' />,
    )
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})

describe('<NewsletterSenderBadge />', () => {
  it('does not nest a link inside the list card', () => {
    render(
      <NewsletterSenderBadge
        verified={false}
        workspaceSlug='acme'
        linked={false}
      />,
    )
    expect(screen.getByText('Domínio não verificado')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
