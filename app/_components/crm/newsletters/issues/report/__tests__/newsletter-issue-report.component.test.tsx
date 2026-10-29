import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/src/__tests__/component-utils'

const state = vi.hoisted(() => ({
  issue: {} as Record<string, unknown>,
}))

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/hooks/use-crm-newsletter-issues', () => ({
  LIVE_ISSUE_STATUSES: ['SCHEDULED', 'SENDING'],
  useCrmNewsletterIssue: () => ({ data: state.issue, isError: false }),
  useCrmNewsletterIssueReport: () => ({ data: undefined }),
  useCrmNewsletterIssueAction: () => ({ mutate: vi.fn(), isPending: false }),
  useCrmNewsletterIssueRecipients: () => ({ data: undefined }),
}))

import { NewsletterIssueReport } from '../newsletter-issue-report'

function issue(overrides: Record<string, unknown>) {
  return {
    id: 'i1',
    newsletterId: 'n1',
    number: null,
    subject: 'Novidades de outubro',
    status: 'DRAFT',
    sentAt: null,
    sendingStartedAt: null,
    scheduledAt: null,
    failureReason: null,
    webUrl: null,
    ...overrides,
  }
}

function setup(overrides: Record<string, unknown>) {
  state.issue = issue(overrides)
  renderWithQuery(
    <NewsletterIssueReport
      workspaceId='ws1'
      slug='acme'
      newsletterId='n1'
      newsletterName='Boletim'
      issueId='i1'
    />,
  )
}

describe('<NewsletterIssueReport /> before the send', () => {
  it('shows an empty state with a link back to the editor for a draft', () => {
    setup({ status: 'DRAFT' })
    expect(screen.getByText('Esta edição ainda não foi enviada')).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: 'Voltar ao editor' })
        .getAttribute('href'),
    ).toBe('/acme/crm/newsletters/n1/issues/i1')
    expect(screen.queryByText('Destinatários')).toBeNull()
    expect(screen.queryByText('Abertura')).toBeNull()
  })

  it('tells when a scheduled issue goes out', () => {
    setup({ status: 'SCHEDULED', scheduledAt: '2026-11-03T12:00:00.000Z' })
    expect(screen.getByText('Esta edição ainda não foi enviada')).toBeTruthy()
    // 12:00 UTC = 09:00 in São Paulo.
    expect(screen.getByText(/O envio está agendado para .*09:00/)).toBeTruthy()
  })

  it('keeps the report for a sent issue', () => {
    setup({ status: 'SENT', sentAt: '2026-10-20T12:00:00.000Z', number: 3 })
    expect(screen.queryByText('Esta edição ainda não foi enviada')).toBeNull()
    expect(screen.getByLabelText('Destinatários')).toBeTruthy()
  })
})
