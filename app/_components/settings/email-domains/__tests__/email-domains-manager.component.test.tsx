import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { SendingDomainDTO } from '@/src/schemas/sending-domain.schema'
import { EmailDomainsManager } from '../email-domains-manager'
import {
  formatDomainDate,
  recordPurpose,
  recordStatus,
} from '../sending-domain-format'

const WS = 'ws-1'
const BASE = `/api/workspaces/${WS}/sending-domains`
const LIST = new RegExp(`${BASE}$`)

function domain(overrides: Partial<SendingDomainDTO> = {}): SendingDomainDTO {
  return {
    id: 'd1',
    name: 'news.acme.com.br',
    status: 'PENDING',
    region: 'sa-east-1',
    records: [
      {
        record: 'SPF',
        type: 'MX',
        name: 'send.news',
        value: 'feedback-smtp.sa-east-1.amazonses.com',
        priority: 10,
        status: 'pending',
      },
      {
        record: 'DKIM',
        type: 'TXT',
        name: 'resend._domainkey.news',
        value: 'p=MIGfMA0',
        status: 'failed',
      },
    ],
    failureReason: null,
    lastCheckedAt: '2026-10-28T15:00:00.000Z',
    verifiedAt: null,
    newslettersCount: 0,
    createdAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  }
}

const DMARC = {
  name: '_dmarc.acme.com.br',
  found: false,
  value: null,
  suggested: 'v=DMARC1; p=none;',
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

describe('sending domain format helpers', () => {
  it('labels records and dates in São Paulo time', () => {
    expect(recordStatus('verified')).toEqual({ label: 'Ok', tone: 'ok' })
    expect(recordStatus('weird')).toEqual({ label: 'weird', tone: 'waiting' })
    const base = { name: 'n', value: 'v', status: 'pending' }
    expect(recordPurpose({ ...base, record: 'SPF', type: 'TXT' })).toContain(
      'Autoriza',
    )
    expect(recordPurpose({ ...base, record: 'SPF', type: 'MX' })).toContain(
      'não entregues',
    )
    expect(recordPurpose({ ...base, record: 'DKIM', type: 'TXT' })).toContain(
      'Assina',
    )
    expect(
      recordPurpose({ ...base, record: 'Tracking', type: 'CNAME' }),
    ).toContain('Rastreio')
    expect(
      recordPurpose({ ...base, record: 'TrackingCAA', type: 'CAA' }),
    ).toContain('Certificado')
    expect(recordPurpose({ ...base, record: 'DMARC', type: 'TXT' })).toContain(
      'falsificação',
    )
    expect(recordPurpose({ ...base, record: 'Other', type: 'TXT' })).toBe(
      'Other',
    )
    expect(formatDomainDate('2026-10-28T15:00:00.000Z')).toBe(
      '28/10/2026, 12:00',
    )
    expect(formatDomainDate(null)).toBeNull()
    expect(formatDomainDate('nope')).toBeNull()
  })
})

describe('<EmailDomainsManager />', () => {
  it('shows the empty state with help text', async () => {
    mockFetch([{ match: LIST, data: [] }])
    renderWithQuery(<EmailDomainsManager workspaceId={WS} />)
    expect(await screen.findByText('Nenhum domínio cadastrado')).toBeTruthy()
    expect(screen.getByText('Como funciona')).toBeTruthy()
  })

  it('adds a domain and opens its DNS records', async () => {
    const spy = mockFetch([
      { match: `${BASE}/d1`, data: { ...domain(), dmarc: DMARC } },
      { match: LIST, data: [] },
      {
        method: 'POST',
        match: LIST,
        status: 201,
        data: { ...domain(), dmarc: DMARC },
      },
    ])
    renderWithQuery(<EmailDomainsManager workspaceId={WS} />)
    await screen.findByText('Nenhum domínio cadastrado')
    fireEvent.click(screen.getByRole('button', { name: /Adicionar domínio/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Por que um subdomínio/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Domínio'), {
      target: { value: 'News.Acme.com.br' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Adicionar domínio' }),
    )
    await waitFor(() =>
      expect(fetchBody(spy, LIST)).toEqual({
        name: 'news.acme.com.br',
        region: 'sa-east-1',
      }),
    )
  })

  it('validates the name before sending', async () => {
    const spy = mockFetch([{ match: LIST, data: [] }])
    renderWithQuery(<EmailDomainsManager workspaceId={WS} />)
    await screen.findByText('Nenhum domínio cadastrado')
    fireEvent.click(screen.getByRole('button', { name: /Adicionar domínio/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Domínio'), {
      target: { value: 'gmail.com' },
    })
    fireEvent.submit(
      within(dialog)
        .getByLabelText('Domínio')
        .closest('form') as HTMLFormElement,
    )
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
    expect(fetchBody(spy, LIST)).toBeUndefined()
  })

  it('shows records, the DMARC hint, verifies and copies', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/d1/verify`,
        data: { ...domain({ status: 'VERIFIED' }), dmarc: DMARC },
      },
      {
        match: `${BASE}/d1`,
        data: {
          ...domain({
            status: 'FAILED',
            failureReason: 'Registros não encontrados no DNS: DKIM.',
          }),
          dmarc: DMARC,
        },
      },
      {
        match: LIST,
        data: [domain({ status: 'FAILED', newslettersCount: 1 })],
      },
    ])
    renderWithQuery(
      <EmailDomainsManager workspaceId={WS} initialDomainId='d1' />,
    )
    expect(await screen.findByText('news.acme.com.br')).toBeTruthy()
    expect(screen.getByText('1 newsletter ativa usa este domínio')).toBeTruthy()
    expect(await screen.findByText('resend._domainkey.news')).toBeTruthy()
    expect(screen.getByText('Não encontrado')).toBeTruthy()
    expect(screen.getByText('prioridade 10')).toBeTruthy()
    expect(
      screen.getByText('Registros não encontrados no DNS: DKIM.'),
    ).toBeTruthy()
    expect(
      screen.getByText('Recomendado: adicione um registro DMARC'),
    ).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Copiar valor' })[0])
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'feedback-smtp.sa-east-1.amazonses.com',
    )

    fireEvent.click(screen.getByRole('button', { name: /Verificar agora/ }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/d1/verify') && init?.method === 'POST',
        ),
      ).toBe(true),
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Ocultar registros DNS' }),
    )
    expect(screen.queryByText('resend._domainkey.news')).toBeNull()
  })

  it('shows a found DMARC and asks before removing', async () => {
    const spy = mockFetch([
      { method: 'DELETE', match: `${BASE}/d1`, data: null },
      {
        match: `${BASE}/d1`,
        data: {
          ...domain({
            status: 'VERIFIED',
            verifiedAt: '2026-10-28T15:00:00.000Z',
          }),
          dmarc: { ...DMARC, found: true, value: 'v=DMARC1; p=reject' },
        },
      },
      { match: LIST, data: [domain({ status: 'VERIFIED' })] },
    ])
    renderWithQuery(<EmailDomainsManager workspaceId={WS} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ver registros DNS' }),
    )
    expect(await screen.findByText('DMARC encontrado')).toBeTruthy()
    expect(screen.getByText('v=DMARC1; p=reject')).toBeTruthy()
    expect(screen.getByText(/Verificado desde/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Remover domínio/ }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
        true,
      ),
    )
  })

  it('shows the unknown DMARC state and the list error', async () => {
    mockFetch([
      {
        match: `${BASE}/d1`,
        data: { ...domain({ records: [] }), dmarc: { ...DMARC, found: null } },
      },
      { match: LIST, data: [domain()] },
    ])
    renderWithQuery(
      <EmailDomainsManager workspaceId={WS} initialDomainId='d1' />,
    )
    expect(
      await screen.findByText('Não foi possível consultar o DMARC agora'),
    ).toBeTruthy()
    expect(screen.getByText(/ainda não devolveu os registros/)).toBeTruthy()
  })

  it('surfaces a list error', async () => {
    mockFetch([{ match: LIST, status: 500, error: 'Falhou geral' }])
    renderWithQuery(<EmailDomainsManager workspaceId={WS} />)
    expect(await screen.findByText('Falhou geral')).toBeTruthy()
  })
})
