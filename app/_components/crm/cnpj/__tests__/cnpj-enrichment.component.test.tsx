import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCnpjRun,
  VALID_CNPJ,
} from '@/src/__tests__/factories/nov-c2-cnpj-enrichment.factory'
import { toCrmCnpjRunDTO } from '@/src/mappers/crm-cnpj.mapper'
import type { CrmCompanyEnrichmentDTO } from '@/types/crm-cnpj'
import {
  appliedSummary,
  formatBrl,
  formatCnae,
  formatIsoDate,
  formatMoment,
} from '../cnpj-labels'

const hooks = vi.hoisted(() => ({
  enrichment: vi.fn(),
  enrich: vi.fn(),
  runs: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/src/hooks/use-crm-cnpj-enrichment', () => ({
  LIVE_CNPJ_RUN_STATUSES: ['QUEUED', 'RUNNING'],
  useCrmCompanyEnrichment: hooks.enrichment,
  useEnrichCrmCompany: hooks.enrich,
  useCrmCnpjRuns: hooks.runs,
  useStartCnpjRun: hooks.start,
  useCancelCnpjRun: hooks.cancel,
}))
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

import { CnpjBulkDialog } from '../cnpj-bulk-dialog'
import { CompanyEnrichmentPanel } from '../company-enrichment-panel'

const PROFILE: CrmCompanyEnrichmentDTO = {
  id: 'e1',
  companyId: 'c1',
  cnpj: VALID_CNPJ,
  legalName: 'ACME LTDA',
  tradeName: 'Acme Mercado',
  cnaeCode: '4711302',
  cnaeDescription: 'Comércio varejista',
  secondaryCnaes: [{ code: '4712100', description: 'Minimercados' }],
  size: 'EPP',
  legalNature: 'Sociedade Limitada',
  registrationStatus: 'ATIVA',
  openedAt: '2015-03-02',
  shareCapital: 50000,
  partners: [
    {
      name: 'MARIA DA SILVA',
      qualification: 'Administrador',
      enteredAt: '2015-03-02',
    },
  ],
  source: 'brasilapi',
  fetchedAt: '2026-11-03T15:30:00.000Z',
}

const mutation = (over = {}) => ({ mutate: vi.fn(), isPending: false, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  hooks.enrichment.mockReturnValue({
    data: PROFILE,
    isLoading: false,
    error: null,
  })
  hooks.enrich.mockReturnValue(mutation())
  hooks.runs.mockReturnValue({ data: [] })
  hooks.start.mockReturnValue(mutation())
  hooks.cancel.mockReturnValue(mutation())
})

const panel = (
  over: Partial<Parameters<typeof CompanyEnrichmentPanel>[0]> = {},
) =>
  render(
    <CompanyEnrichmentPanel
      workspaceId='ws'
      companyId='c1'
      cnpj={VALID_CNPJ}
      canEdit
      onApplied={vi.fn()}
      {...over}
    />,
  )

describe('cnpj labels', () => {
  it('formats CNAE, dates, money and moments in Brazil time', () => {
    expect(formatCnae('4711302')).toBe('4711-3/02')
    expect(formatCnae('12')).toBe('12')
    expect(formatCnae(null)).toBe('')
    expect(formatIsoDate('2015-03-02')).toBe('02/03/2015')
    expect(formatIsoDate(null)).toBe('')
    expect(formatBrl(1500.5).replace(/\s/g, ' ')).toBe('R$ 1.500,50')
    expect(formatBrl(null)).toBe('')
    expect(formatMoment('2026-11-03T02:30:00.000Z')).toContain('02/11/2026')
    expect(formatMoment(null)).toBe('')
  })

  it('summarizes what an enrichment applied', () => {
    expect(appliedSummary([])).toContain('já estavam preenchidos')
    expect(appliedSummary(['name', 'address'])).toContain('nome e endereço')
  })
})

describe('<CompanyEnrichmentPanel />', () => {
  it('shows the Receita profile', () => {
    panel()
    expect(screen.getByText('ACME LTDA')).toBeTruthy()
    expect(screen.getByText(/4711-3\/02/)).toBeTruthy()
    expect(screen.getByText('MARIA DA SILVA')).toBeTruthy()
    expect(screen.getByText(/CNAEs secundários \(1\)/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Atualizar da Receita/ }),
    ).toBeTruthy()
  })

  it('asks to fetch before the first enrichment and sends overwrite', () => {
    const mutate = vi.fn()
    hooks.enrichment.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    })
    hooks.enrich.mockReturnValue(mutation({ mutate }))
    panel()
    expect(screen.getByText(/Ainda não consultado/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /Buscar na Receita/ }))
    expect(mutate).toHaveBeenCalledWith({ overwrite: true }, expect.anything())
  })

  it('hides the actions from users who cannot edit', () => {
    panel({ canEdit: false })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('explains a missing or invalid CNPJ', () => {
    const { unmount } = panel({ cnpj: null })
    expect(screen.getByText(/Informe o CNPJ/)).toBeTruthy()
    unmount()
    panel({ cnpj: '123' })
    expect(screen.getByText(/inválido/)).toBeTruthy()
  })

  it('shows loading and error states', () => {
    hooks.enrichment.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    const { unmount } = panel()
    expect(screen.queryByText('ACME LTDA')).toBeNull()
    unmount()
    hooks.enrichment.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Falhou'),
    })
    panel()
    expect(screen.getByRole('alert').textContent).toBe('Falhou')
  })
})

describe('<CnpjBulkDialog />', () => {
  function open() {
    render(<CnpjBulkDialog workspaceId='ws' onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Enriquecer base/ }))
  }

  it('starts a run with the chosen options', () => {
    const mutate = vi.fn()
    hooks.start.mockReturnValue(mutation({ mutate }))
    open()
    fireEvent.click(screen.getAllByRole('switch')[1])
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar consulta' }))
    expect(mutate).toHaveBeenCalledWith(
      { onlyMissing: true, overwrite: true },
      expect.anything(),
    )
  })

  it('cancels a live run and shows the pending cancel', () => {
    const mutate = vi.fn()
    hooks.cancel.mockReturnValue(mutation({ mutate }))
    const live = toCrmCnpjRunDTO(
      createFakeCnpjRun({ id: 'run1', status: 'RUNNING', total: 10 }),
    )
    hooks.runs.mockReturnValue({ data: [live] })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(mutate).toHaveBeenCalledWith('run1', expect.anything())
  })

  it('disables the cancel button once the cancel was requested', () => {
    hooks.runs.mockReturnValue({
      data: [
        toCrmCnpjRunDTO(
          createFakeCnpjRun({
            status: 'RUNNING',
            cancelRequestedAt: new Date(),
          }),
        ),
      ],
    })
    open()
    const button = screen.getByRole('button', { name: 'Cancelando…' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('does not offer cancel for a finished run', () => {
    hooks.runs.mockReturnValue({
      data: [toCrmCnpjRunDTO(createFakeCnpjRun({ status: 'CANCELED' }))],
    })
    open()
    expect(screen.getByText('Cancelado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull()
  })

  it('lists past runs and locks the button while one is live', () => {
    hooks.runs.mockReturnValue({
      data: [
        toCrmCnpjRunDTO(
          createFakeCnpjRun({ status: 'RUNNING', total: 10, processed: 4 }),
        ),
        toCrmCnpjRunDTO(
          createFakeCnpjRun({ status: 'FAILED', error: 'Falha na fila' }),
        ),
      ],
    })
    open()
    expect(screen.getByText('4 / 10')).toBeTruthy()
    expect(screen.getByText('Falha na fila')).toBeTruthy()
    const button = screen.getByRole('button', { name: /Consulta em andamento/ })
    expect(button.hasAttribute('disabled')).toBe(true)
  })
})
