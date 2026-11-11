import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { OpportunityProposalButton } from '../opportunity-proposal-button'

const { notify, push } = vi.hoisted(() => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
  push: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ 'workspace-slug': 'acme' }),
}))

const PATH = '/crm/opportunities/op1/proposal'

describe('<OpportunityProposalButton />', () => {
  it('creates the proposal document and opens its editor', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: PATH,
        data: { id: 'doc1', path: '/crm/documents/doc1' },
      },
    ])
    renderWithQuery(
      <OpportunityProposalButton workspaceId='ws1' opportunityId='op1' />,
    )

    fireEvent.click(screen.getByText('Gerar proposta'))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/doc1/edit'),
    )
    expect(notify.success).toHaveBeenCalledWith('Proposta criada')
    expect(fetchBody(fetchSpy, PATH)).toEqual({})
  })

  it('shows the API error and stays put', async () => {
    mockFetch([
      { method: 'POST', match: PATH, status: 404, error: 'Não encontrada' },
    ])
    renderWithQuery(
      <OpportunityProposalButton
        workspaceId='ws1'
        opportunityId='op1'
        label='Proposta de renovação'
      />,
    )

    fireEvent.click(screen.getByText('Proposta de renovação'))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })
})
