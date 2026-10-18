import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import { SteelAiPendingActionCard } from '../steel-ai-pending-action-card'
import { pendingAction, renderSteelAi, WS } from './steel-ai-test-utils'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

describe('<SteelAiPendingActionCard />', () => {
  it('shows the preview with before → after and the target link', () => {
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    expect(
      screen.getByRole('heading', {
        name: 'Alterar a oportunidade “Contrato Acme”',
      }),
    ).toBeTruthy()
    expect(screen.getByText('Proposta')).toBeTruthy()
    expect(screen.getByText('Negociação')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Contrato Acme/ }).getAttribute('href'),
    ).toBe('/acme/crm/opportunities/op_1')
    expect(screen.getByText('Aguardando sua confirmação')).toBeTruthy()
  })

  it('names the target record in pt-BR instead of the internal type', () => {
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    expect(screen.getByText('Oportunidade')).toBeTruthy()
    expect(screen.queryByText(/crm_opportunity/)).toBeNull()
  })

  it('falls back to a generic label for an unknown target type', () => {
    const base = pendingAction()
    renderSteelAi(
      <SteelAiPendingActionCard
        workspaceId={WS}
        action={{
          ...base,
          preview: {
            ...base.preview,
            target: { type: 'crm_something_new', label: 'Registro X' },
          },
        }}
      />,
    )
    expect(screen.getByText('Registro')).toBeTruthy()
    expect(screen.getByText('Registro X')).toBeTruthy()
    expect(screen.queryByText(/crm_something_new/)).toBeNull()
  })

  it('confirms with a single click and shows the result', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/ai/actions/act_1/confirm',
        data: pendingAction({
          status: 'EXECUTED',
          resultSummary: 'Oportunidade movida para Negociação.',
        }),
      },
    ])
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(
      await screen.findByText(/Oportunidade movida para Negociação/),
    ).toBeTruthy()
    expect(screen.getByText('Executada')).toBeTruthy()
    expect(fetchBody(spy, '/confirm')).toEqual({})
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
  })

  it('asks twice before a delete and sends doubleConfirmed', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/ai/actions/act_1/confirm',
        data: pendingAction({
          kind: 'DELETE',
          status: 'EXECUTED',
          resultSummary: 'Oportunidade excluída.',
        }),
      },
    ])
    renderSteelAi(
      <SteelAiPendingActionCard
        workspaceId={WS}
        action={pendingAction({
          kind: 'DELETE',
          requiresDoubleConfirm: true,
          preview: {
            title: 'Excluir a oportunidade “Contrato Acme”',
            summary: 'Remove a oportunidade e o histórico dela.',
          },
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    // First click only opens the second confirmation.
    expect(await screen.findByText('Confirmar exclusão?')).toBeTruthy()
    expect(fetchBody(spy, '/confirm')).toBeUndefined()

    fireEvent.click(
      screen.getByRole('button', { name: 'Excluir definitivamente' }),
    )
    expect(await screen.findByText(/Oportunidade excluída/)).toBeTruthy()
    expect(fetchBody(spy, '/confirm')).toEqual({ doubleConfirmed: true })
  })

  it('backs out of the second confirmation without executing', async () => {
    const spy = mockFetch([])
    renderSteelAi(
      <SteelAiPendingActionCard
        workspaceId={WS}
        action={pendingAction({ kind: 'DELETE' })}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar' }))
    await waitFor(() =>
      expect(screen.queryByText('Confirmar exclusão?')).toBeNull(),
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('cancels the proposal', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/ai/actions/act_1/cancel',
        data: pendingAction({ status: 'CANCELED' }),
      },
    ])
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByText('Cancelada')).toBeTruthy()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while executing', async () => {
    let release: (value: Response) => void = () => {}
    mockFetch([
      {
        method: 'POST',
        match: '/confirm',
        handler: () =>
          new Promise<Response>((resolve) => {
            release = resolve
          }),
      },
    ])
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    const running = await screen.findByRole('button', { name: /Executando/ })
    expect((running as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    release(
      new Response(
        JSON.stringify({
          success: true,
          statusCode: 200,
          data: pendingAction({ status: 'FAILED', error: 'Sem permissão.' }),
        }),
        { status: 200 },
      ),
    )
    expect(await screen.findByText(/Sem permissão/)).toBeTruthy()
    expect(screen.getByText('Falhou')).toBeTruthy()
  })

  it('treats an action past its deadline as expired', () => {
    renderSteelAi(
      <SteelAiPendingActionCard
        workspaceId={WS}
        action={pendingAction({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })}
      />,
    )
    expect(screen.getByText(/Expirada/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
  })

  it('marks the card expired when the server says so', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/confirm',
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              statusCode: 410,
              message: 'A ação expirou.',
              error: { code: 'AI_PENDING_ACTION_EXPIRED' },
            }),
            { status: 410 },
          ),
      },
    ])
    renderSteelAi(
      <SteelAiPendingActionCard workspaceId={WS} action={pendingAction()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(await screen.findByText(/Expirada/)).toBeTruthy()
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('shows the fresh preview when the record changed after the proposal', async () => {
    const base = pendingAction()
    const fresh = pendingAction({
      preview: {
        ...base.preview,
        title: 'Alterar a oportunidade “Contrato Acme 2027”',
      },
    })
    mockFetch([
      {
        method: 'POST',
        match: '/confirm',
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              statusCode: 409,
              message:
                'O registro mudou desde a prévia. Revise e confirme de novo.',
              error: {
                code: 'AI_PENDING_ACTION_CHANGED',
                details: { action: fresh },
              },
            }),
            { status: 409 },
          ),
      },
    ])
    renderSteelAi(<SteelAiPendingActionCard workspaceId={WS} action={base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(
      await screen.findByRole('heading', {
        name: 'Alterar a oportunidade “Contrato Acme 2027”',
      }),
    ).toBeTruthy()
    expect(notify.warning).toHaveBeenCalledWith(
      'O registro mudou desde a prévia. Revise e confirme de novo.',
    )
    expect(notify.error).not.toHaveBeenCalled()
    // Still pending: the user confirms the new preview.
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeTruthy()
  })
})
