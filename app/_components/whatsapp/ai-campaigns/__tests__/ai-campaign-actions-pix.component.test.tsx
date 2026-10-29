import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import {
  type AiCampaignActionDraft,
  AiCampaignActionsEditor,
  actionDraftProblem,
} from '../ai-campaign-actions-editor'

vi.setConfig({ testTimeout: 20_000 })

const base = { id: 'p1', label: 'Cobrar adesão', when: 'Aceitou a proposta' }

describe('actionDraftProblem · SEND_PIX', () => {
  it('requires an amount within the Pix limits and a description', () => {
    expect(actionDraftProblem({ ...base, kind: 'SEND_PIX' })).toMatch(/valor/)
    expect(
      actionDraftProblem({ ...base, kind: 'SEND_PIX', amount: 0 }),
    ).toMatch(/valor/)
    expect(
      actionDraftProblem({ ...base, kind: 'SEND_PIX', amount: 1_000_000 }),
    ).toMatch(/valor/)
    expect(
      actionDraftProblem({ ...base, kind: 'SEND_PIX', amount: 10 }),
    ).toMatch(/Descreva/)
    expect(
      actionDraftProblem({
        ...base,
        kind: 'SEND_PIX',
        amount: 10,
        description: '   ',
      }),
    ).toMatch(/Descreva/)
    expect(
      actionDraftProblem({
        ...base,
        kind: 'SEND_PIX',
        amount: 10,
        description: 'Taxa',
      }),
    ).toBeNull()
  })
})

describe('<AiCampaignActionsEditor /> SEND_PIX', () => {
  it('edits the fixed amount and description the AI will charge', () => {
    mockFetch([])
    const onChange = vi.fn()
    const action: AiCampaignActionDraft = {
      ...base,
      kind: 'SEND_PIX',
      amount: 99.9,
      description: 'Taxa de adesão',
    }
    renderWithQuery(
      <AiCampaignActionsEditor
        workspaceId='ws_1'
        actions={[action]}
        onChange={onChange}
      />,
    )

    expect(screen.getByText(/Enviar cobrança Pix/)).toBeTruthy()
    const amount = screen.getByLabelText('Valor (R$)') as HTMLInputElement
    expect(amount.value).toBe('99.9')
    fireEvent.change(amount, { target: { value: '120.5' } })
    expect(onChange).toHaveBeenLastCalledWith([{ ...action, amount: 120.5 }])

    fireEvent.change(screen.getByLabelText('O que está sendo cobrado'), {
      target: { value: 'Mensalidade' },
    })
    expect(onChange).toHaveBeenLastCalledWith([
      { ...action, description: 'Mensalidade' },
    ])
  })
})
