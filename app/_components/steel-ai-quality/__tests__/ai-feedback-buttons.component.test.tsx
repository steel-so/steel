import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { AiFeedbackDTO } from '@/types/ai-quality'
import { AiFeedbackButtons, AiFeedbackControl } from '../ai-feedback-buttons'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const WS = 'ws_1'

function feedback(over: Partial<AiFeedbackDTO> = {}): AiFeedbackDTO {
  return {
    id: 'fb_1',
    surface: 'STEEL_AI_MESSAGE',
    targetId: 'm1',
    variant: '',
    rating: 'UP',
    reason: null,
    comment: null,
    modelKey: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    updatedAt: '2026-10-18T12:00:00.000Z',
    ...over,
  }
}

describe('<AiFeedbackButtons />', () => {
  it('rates up and marks the pressed thumb', async () => {
    const spy = mockFetch([
      { method: 'POST', match: '/ai/feedback', data: feedback() },
    ])
    renderWithQuery(
      <AiFeedbackButtons
        workspaceId={WS}
        surface='STEEL_AI_MESSAGE'
        targetId='m1'
        feedback={null}
      />,
    )
    const up = screen.getByRole('button', { name: 'Resposta útil' })
    expect(up.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(up)
    await waitFor(() =>
      expect(fetchBody(spy, '/ai/feedback')).toEqual({
        surface: 'STEEL_AI_MESSAGE',
        targetId: 'm1',
        variant: '',
        rating: 'UP',
      }),
    )
  })

  it('undoes an active thumbs up', async () => {
    const spy = mockFetch([
      { method: 'DELETE', match: '/ai/feedback/fb_1', data: { id: 'fb_1' } },
    ])
    renderWithQuery(
      <AiFeedbackButtons
        workspaceId={WS}
        surface='STEEL_AI_MESSAGE'
        targetId='m1'
        feedback={feedback()}
      />,
    )
    const up = screen.getByRole('button', { name: 'Resposta útil' })
    expect(up.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(up)
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('sends a thumbs down with reason and comment', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: '/ai/feedback',
        data: feedback({ rating: 'DOWN' }),
      },
    ])
    renderWithQuery(
      <AiFeedbackButtons
        workspaceId={WS}
        surface='SD_COPILOT'
        targetId='t1'
        variant='summary'
        feedback={null}
        label='Ajudou?'
      />,
    )
    expect(screen.getByText('Ajudou?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resposta não ajudou' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Incompleta' }))
    fireEvent.change(screen.getByLabelText('Comentário'), {
      target: { value: ' faltou o prazo ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(fetchBody(spy, '/ai/feedback')).toEqual({
        surface: 'SD_COPILOT',
        targetId: 't1',
        variant: 'summary',
        rating: 'DOWN',
        reason: 'incomplete',
        comment: 'faltou o prazo',
      }),
    )
  })

  it('keeps the buttons disabled while the rating loads', () => {
    mockFetch([])
    renderWithQuery(
      <AiFeedbackButtons
        workspaceId={WS}
        surface='STEEL_AI_MESSAGE'
        targetId='m1'
        feedback={undefined}
      />,
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Resposta útil',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })
})

describe('<AiFeedbackControl />', () => {
  it('loads the caller rating of its answer', async () => {
    mockFetch([
      {
        match: '/ai/feedback?surface=STEEL_AGENT_RUN&targetIds=r1',
        data: [
          feedback({
            surface: 'STEEL_AGENT_RUN',
            targetId: 'r1',
            rating: 'DOWN',
          }),
        ],
      },
    ])
    renderWithQuery(
      <AiFeedbackControl
        workspaceId={WS}
        surface='STEEL_AGENT_RUN'
        targetId='r1'
      />,
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: 'Resposta não ajudou' })
          .getAttribute('aria-pressed'),
      ).toBe('true'),
    )
  })

  it('stays usable when the rating cannot load', async () => {
    mockFetch([])
    renderWithQuery(
      <AiFeedbackControl
        workspaceId={WS}
        surface='STEEL_AGENT_RUN'
        targetId='r1'
      />,
    )
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Resposta útil',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
  })
})
