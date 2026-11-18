import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import { jsonResponse, mockFetch } from '@/src/__tests__/helpers/fetch.helpers'
import type {
  CrmNewsletterWhatsAppRecipientDTO,
  CrmNewsletterWhatsAppReportDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import {
  IssueWhatsAppSection,
  whatsappRowLabel,
} from '../issue-whatsapp-section'

const PROPS = {
  workspaceId: 'ws1',
  slug: 'acme',
  newsletterId: 'nl1',
  issueId: 'is1',
}

function row(
  overrides: Partial<CrmNewsletterWhatsAppRecipientDTO>,
): CrmNewsletterWhatsAppRecipientDTO {
  return {
    id: 'w1',
    name: 'Ana Lima',
    phone: '+5511999990000',
    personId: null,
    status: 'SENT',
    skipReason: null,
    error: null,
    sentAt: '2026-10-28T13:10:00.000Z',
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    ...overrides,
  }
}

const REPORT: CrmNewsletterWhatsAppReportDTO = {
  enabled: true,
  provider: 'META',
  pausedReason: null,
  stats: {
    total: 5,
    pending: 0,
    sent: 4,
    failed: 1,
    skipped: 0,
    delivered: 3,
    read: 1,
  },
  items: [
    row({
      id: 'w1',
      name: 'Ana',
      deliveredAt: '2026-10-28T13:11:00.000Z',
      readAt: '2026-10-28T14:05:00.000Z',
    }),
    row({ id: 'w2', name: 'Bia', deliveredAt: '2026-10-28T13:12:00.000Z' }),
    row({ id: 'w3', name: 'Caio' }),
    row({
      id: 'w4',
      name: 'Davi',
      status: 'FAILED',
      error: '131026: Message undeliverable',
      failedAt: '2026-10-28T13:15:00.000Z',
    }),
  ],
  total: 4,
  page: 1,
  pageSize: 25,
}

describe('IssueWhatsAppSection receipts (nl3-whatsapp-receipts)', () => {
  it('shows sent/delivered/read/failed counts and the read rate', async () => {
    mockFetch(() => jsonResponse({ success: true, data: REPORT }))
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)
    await screen.findByText('(template da Meta)')
    const tile = (label: string) =>
      (screen.getByText(label).parentElement as HTMLElement).textContent
    expect(tile('Enviados')).toBe('Enviados4')
    expect(tile('Entregues')).toBe('Entregues3')
    expect(tile('Lidos')).toBe('Lidos1')
    expect(tile('Taxa de leitura')).toBe('Taxa de leitura25%')
    expect(tile('Falharam')).toBe('Falharam1')
  })

  it('shows each number with its furthest receipt and timestamps (São Paulo)', async () => {
    mockFetch(() => jsonResponse({ success: true, data: REPORT }))
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)
    await screen.findByText('Ana')
    const line = (name: string) =>
      screen.getByText(name).closest('tr') as HTMLElement
    expect(within(line('Ana')).getByText('Lido')).toBeTruthy()
    expect(within(line('Ana')).getByText(/11:05/)).toBeTruthy()
    expect(within(line('Ana')).getByText(/10:11/)).toBeTruthy()
    expect(within(line('Bia')).getByText('Entregue')).toBeTruthy()
    expect(within(line('Caio')).getByText('Enviado')).toBeTruthy()
    expect(within(line('Davi')).getByText('Falhou')).toBeTruthy()
    expect(
      within(line('Davi')).getByText(/131026: Message undeliverable \(/),
    ).toBeTruthy()
    expect(
      screen.getAllByRole('columnheader').map((h) => h.textContent),
    ).toEqual(['Contato', 'Situação', 'Enviado em', 'Entregue em', 'Lido em'])
  })

  it('shows "—" as read rate when nothing was sent yet', async () => {
    mockFetch(() =>
      jsonResponse({
        success: true,
        data: {
          ...REPORT,
          stats: { ...REPORT.stats, sent: 0, delivered: 0, read: 0 },
          items: [row({ status: 'PENDING', sentAt: null })],
        },
      }),
    )
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)
    await screen.findByText('Taxa de leitura')
    expect(
      (screen.getByText('Taxa de leitura').parentElement as HTMLElement)
        .textContent,
    ).toBe('Taxa de leitura—')
  })

  it('labels rows by status, skip reason and receipt', () => {
    expect(whatsappRowLabel(row({ readAt: 'x', deliveredAt: 'x' }))).toBe(
      'Lido',
    )
    expect(whatsappRowLabel(row({ deliveredAt: 'x' }))).toBe('Entregue')
    expect(whatsappRowLabel(row({}))).toBe('Enviado')
    expect(whatsappRowLabel(row({ status: 'PENDING' }))).toBe('Na fila')
    expect(
      whatsappRowLabel(row({ status: 'SKIPPED', skipReason: 'LIMIT_REACHED' })),
    ).toBe('Limite mensal da Comunicação atingido')
    expect(
      whatsappRowLabel(row({ status: 'SKIPPED', skipReason: 'UNKNOWN' })),
    ).toBe('Não enviado')
    expect(whatsappRowLabel(row({ status: 'SKIPPED' }))).toBe('Não enviado')
  })
})

describe('IssueWhatsAppSection quality gate', () => {
  const HELD = {
    ...REPORT,
    pausedReason:
      'Envios bloqueados pela qualidade: o número desta conexão está com qualidade "Baixa" (vermelha) na Meta.',
    stats: { ...REPORT.stats, pending: 2 },
  }

  it('says the send is held and keeps the numbers pending', async () => {
    mockFetch(() => jsonResponse({ success: true, data: HELD }))
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)

    expect(
      await screen.findByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeTruthy()
    expect(
      screen.getByText(/O número desta conexão está com qualidade/),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Continuar envio no WhatsApp' }),
    ).toBeTruthy()
  })

  it('posts the resume and refreshes', async () => {
    const calls = mockFetch((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/whatsapp/resume')) {
        return jsonResponse({ success: true, data: null })
      }
      return jsonResponse({ success: true, data: HELD })
    })
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Continuar envio no WhatsApp',
      }),
    )

    await waitFor(() =>
      expect(
        calls
          .calls()
          .some(
            (call) =>
              call.init?.method === 'POST' &&
              call.url.endsWith('/issues/is1/whatsapp/resume'),
          ),
      ).toBe(true),
    )
  })

  it('shows nothing extra when the send is not held', async () => {
    mockFetch(() => jsonResponse({ success: true, data: REPORT }))
    renderWithProviders(<IssueWhatsAppSection {...PROPS} />)

    await screen.findByText('(template da Meta)')
    expect(
      screen.queryByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Continuar envio no WhatsApp' }),
    ).toBeNull()
  })
})
