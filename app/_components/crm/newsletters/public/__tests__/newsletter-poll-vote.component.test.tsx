import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CrmNewsletterPollVoteResultDTO } from '@/src/schemas/crm-newsletter-engage.schema'
import { NewsletterPollVote } from '../newsletter-poll-vote'

const RESULT: CrmNewsletterPollVoteResultDTO = {
  newsletterName: 'Novidades Acme',
  question: 'Gostou?',
  chosenIndex: 1,
  chosenLabel: 'Não',
  changed: false,
  results: {
    totalVotes: 4,
    options: [
      { index: 0, label: 'Sim', votes: 3 },
      { index: 1, label: 'Não', votes: 1 },
    ],
  },
}

function mockVote(...responses: Array<[number, unknown] | Error>) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift()
    if (!next || next instanceof Error) throw next ?? new Error('no response')
    return new Response(JSON.stringify(next[1]), {
      status: next[0],
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.unstubAllGlobals())

describe('NewsletterPollVote', () => {
  it('should post the vote after loading and show the results', async () => {
    const spy = mockVote([200, { success: true, data: RESULT }])
    render(<NewsletterPollVote token='tok.sig' />)
    expect(screen.getByText('Registrando seu voto…')).toBeTruthy()
    await screen.findByText('Obrigado pelo seu voto!')
    expect(spy).toHaveBeenCalledWith('/api/newsletters/polls/tok.sig', {
      method: 'POST',
    })
    expect(screen.getByText('Novidades Acme')).toBeTruthy()
    expect(screen.getByText('Não', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('4 votos até agora')).toBeTruthy()
  })

  it('should say the vote was updated and hide hidden results', async () => {
    mockVote([
      200,
      { success: true, data: { ...RESULT, changed: true, results: null } },
    ])
    render(<NewsletterPollVote token='t' />)
    await screen.findByText('Voto atualizado')
    expect(screen.queryByLabelText('Resultado parcial')).toBeNull()
  })

  it('should show one vote in the singular', async () => {
    mockVote([
      200,
      {
        success: true,
        data: {
          ...RESULT,
          results: {
            totalVotes: 1,
            options: [
              { index: 0, label: 'Sim', votes: 0 },
              { index: 1, label: 'Não', votes: 1 },
            ],
          },
        },
      },
    ])
    render(<NewsletterPollVote token='t' />)
    await screen.findByText('1 voto até agora')
  })

  it('should show the invalid-link message for unknown polls', async () => {
    mockVote([
      404,
      { success: false, error: { code: 'CRM_NEWSLETTER_POLL_NOT_FOUND' } },
    ])
    render(<NewsletterPollVote token='t' />)
    await screen.findByText('Link inválido')
  })

  it('should let the reader retry after a failure', async () => {
    const spy = mockVote(
      [
        429,
        { success: false, error: { code: 'RATE_LIMITED', message: 'Calma' } },
      ],
      new Error('offline'),
      [500, null],
      [200, { success: true, data: RESULT }],
    )
    render(<NewsletterPollVote token='t' />)
    await screen.findByText('Calma')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByText('Falha de conexão. Tente novamente.')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await screen.findByText(
      'Não foi possível registrar o seu voto. Tente novamente.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(4))
    await screen.findByText('Obrigado pelo seu voto!')
  })
})
