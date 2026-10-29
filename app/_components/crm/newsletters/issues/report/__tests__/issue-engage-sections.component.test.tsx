import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import { jsonResponse, mockFetch } from '@/src/__tests__/helpers/fetch.helpers'
import type {
  CrmNewsletterIssuePollsDTO,
  CrmNewsletterWhatsAppReportDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import { IssuePollsSection } from '../issue-polls-section'
import { IssueWhatsAppSection } from '../issue-whatsapp-section'

const PROPS = {
  workspaceId: 'ws1',
  slug: 'acme',
  newsletterId: 'nl1',
  issueId: 'is1',
}

const POLLS: CrmNewsletterIssuePollsDTO = {
  polls: [
    {
      blockId: 'poll1',
      question: 'Gostou?',
      showResults: false,
      totalVotes: 3,
      options: [
        { index: 0, label: 'Sim', votes: 2 },
        { index: 1, label: 'Não', votes: 1 },
      ],
      voters: [
        {
          id: 'v1',
          name: 'Ana Lima',
          email: 'ana@example.com',
          personId: 'p1',
          optionIndex: 0,
          votedAt: '2026-10-28T13:00:00.000Z',
        },
        {
          id: 'v2',
          name: null,
          email: 'bia@example.com',
          personId: null,
          optionIndex: 1,
          votedAt: '2026-10-28T13:05:00.000Z',
        },
      ],
      votersTruncated: true,
    },
    {
      blockId: 'poll2',
      question: '',
      showResults: true,
      totalVotes: 0,
      options: [
        { index: 0, label: 'A', votes: 0 },
        { index: 1, label: 'B', votes: 0 },
      ],
      voters: [],
      votersTruncated: false,
    },
  ],
}

const WHATSAPP: CrmNewsletterWhatsAppReportDTO = {
  enabled: true,
  provider: 'ZAPI',
  stats: {
    total: 3,
    pending: 0,
    sent: 1,
    failed: 1,
    skipped: 1,
    delivered: 0,
    read: 0,
  },
  items: [
    {
      id: 'w1',
      name: 'Ana Lima',
      phone: '+5511999990000',
      personId: 'p1',
      status: 'SENT',
      skipReason: null,
      error: null,
      sentAt: '2026-10-28T13:10:00.000Z',
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    },
    {
      id: 'w2',
      name: 'Bia',
      phone: '+5511988880000',
      personId: null,
      status: 'FAILED',
      skipReason: null,
      error: 'Número sem WhatsApp',
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    },
    {
      id: 'w3',
      name: 'Caio',
      phone: '+5511977770000',
      personId: null,
      status: 'SKIPPED',
      skipReason: 'OPTED_OUT',
      error: null,
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    },
  ],
  total: 60,
  page: 1,
  pageSize: 25,
}

describe('IssuePollsSection', () => {
  it('should show bars, voters with CRM links and the CSV export', async () => {
    mockFetch(() => jsonResponse({ success: true, data: POLLS }))
    renderWithProviders(<IssuePollsSection {...PROPS} />)
    await screen.findByText('Gostou?')
    expect(screen.getByText('Resultado oculto para leitores')).toBeTruthy()
    expect(screen.getByText('3 votos')).toBeTruthy()
    expect(screen.getByText('0 votos')).toBeTruthy()
    expect(screen.getByText('Enquete sem pergunta')).toBeTruthy()
    expect(screen.getByText('Nenhum voto ainda.')).toBeTruthy()
    expect(screen.getByText(/mais recentes — o CSV traz todos/)).toBeTruthy()
    const person = screen.getByRole('link', { name: 'Ana Lima' })
    expect(person.getAttribute('href')).toBe('/acme/crm/people?record=p1')
    expect(screen.getByText('bia@example.com')).toBeTruthy()
    const csv = screen.getByRole('link', { name: /Exportar votos/ })
    expect(csv.getAttribute('href')).toBe(
      '/api/workspaces/ws1/crm/newsletters/nl1/issues/is1/polls/export',
    )
  })

  it('should render nothing without polls', async () => {
    const { spy: fetch } = mockFetch(() =>
      jsonResponse({ success: true, data: { polls: [] } }),
    )
    const { container } = renderWithProviders(
      <IssuePollsSection {...PROPS} live />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})

describe('IssueWhatsAppSection', () => {
  it('should show the totals and each number status', async () => {
    const { spy: fetch } = mockFetch(() =>
      jsonResponse({ success: true, data: WHATSAPP }),
    )
    const { user } = renderWithProviders(<IssueWhatsAppSection {...PROPS} />)
    await screen.findByText('(Z-API)')
    expect(screen.getByText('Número sem WhatsApp')).toBeTruthy()
    expect(screen.getByText('Pediu para sair das transmissões')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Ana Lima' }).getAttribute('href'),
    ).toBe('/acme/crm/people?record=p1')
    expect(screen.getByText('1 de 3')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(String(fetch.mock.lastCall?.[0])).toContain('page=2'),
    )
    await user.click(screen.getByRole('button', { name: 'Anterior' }))
  })

  it('should explain the wait and hide when there was no WhatsApp', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        data: {
          ...WHATSAPP,
          provider: 'META',
          stats: {
            total: 0,
            pending: 0,
            sent: 0,
            failed: 0,
            skipped: 0,
            delivered: 0,
            read: 0,
          },
          items: [],
          total: 0,
        },
      }),
    )
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)
    await screen.findByText('(template da Meta)')
    expect(screen.getByText(/O WhatsApp sai quando o envio/)).toBeTruthy()
  })

  it('should render nothing when the issue had no WhatsApp version', async () => {
    const { spy: fetch } = mockFetch(() =>
      jsonResponse({
        success: true,
        data: {
          ...WHATSAPP,
          enabled: false,
          provider: null,
          stats: {
            total: 0,
            pending: 0,
            sent: 0,
            failed: 0,
            skipped: 0,
            delivered: 0,
            read: 0,
          },
          items: [],
          total: 0,
        },
      }),
    )
    const { container } = renderWithProviders(
      <IssueWhatsAppSection {...PROPS} />,
    )
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
