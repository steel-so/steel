import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WorkspaceAiGuardrailsDTO } from '@/types/ai-guardrails'
import { AiGuardrailsSection } from '../ai-guardrails-section'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = '/api/workspaces/ws_1/ai-guardrails'

function guardrails(
  overrides?: Partial<WorkspaceAiGuardrailsDTO>,
): WorkspaceAiGuardrailsDTO {
  return {
    workspaceId: 'ws_1',
    piiMaskingPolicy: 'AUTO_REPLIES',
    injectionClassifierEnabled: false,
    forbiddenTopics: ['processo judicial'],
    maxDiscountPercent: 10,
    maxRefundAmount: 150.5,
    maxDeadlineDays: null,
    updatedAt: null,
    canManage: true,
    ...overrides,
  }
}

describe('<AiGuardrailsSection />', () => {
  it('shows the guardrails in force, read-only for a member', async () => {
    mockFetch([{ match: URL, data: guardrails({ canManage: false }) }])
    renderWithQuery(<AiGuardrailsSection workspaceId='ws_1' />)

    expect(await screen.findByText('Dados pessoais')).toBeTruthy()
    expect(
      (screen.getByLabelText('Assuntos proibidos') as HTMLTextAreaElement)
        .value,
    ).toBe('processo judicial')
    expect(
      (screen.getByLabelText('Reembolso máximo (R$)') as HTMLInputElement)
        .value,
    ).toBe('150,5')
    expect(
      screen.queryByRole('button', { name: 'Salvar proteções' }),
    ).toBeNull()
    expect(screen.getByText(/Apenas o dono e os administradores/)).toBeTruthy()
  })

  it('lets an admin save topics and limits, deduplicating topics', async () => {
    const fetchSpy = mockFetch([
      { method: 'PATCH', match: URL, data: guardrails() },
      { match: URL, data: guardrails() },
    ])
    renderWithQuery(<AiGuardrailsSection workspaceId='ws_1' />)

    fireEvent.change(await screen.findByLabelText('Assuntos proibidos'), {
      target: { value: 'Portabilidade\nportabilidade, jurídico' },
    })
    fireEvent.change(screen.getByLabelText('Desconto máximo (%)'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Prazo máximo (dias)'), {
      target: { value: '7' },
    })
    fireEvent.click(
      screen.getByRole('switch', { name: 'Verificação extra com IA' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar proteções' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Proteções da IA salvas'),
    )
    expect(fetchBody(fetchSpy, URL, 'PATCH')).toEqual({
      piiMaskingPolicy: 'AUTO_REPLIES',
      injectionClassifierEnabled: true,
      forbiddenTopics: ['Portabilidade', 'jurídico'],
      maxDiscountPercent: null,
      maxRefundAmount: 150.5,
      maxDeadlineDays: 7,
    })
  })

  it('refuses an invalid limit before calling the API', async () => {
    const fetchSpy = mockFetch([{ match: URL, data: guardrails() }])
    renderWithQuery(<AiGuardrailsSection workspaceId='ws_1' />)

    fireEvent.change(await screen.findByLabelText('Desconto máximo (%)'), {
      target: { value: '150' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar proteções' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, URL, 'PATCH')).toBeUndefined()
  })
})
