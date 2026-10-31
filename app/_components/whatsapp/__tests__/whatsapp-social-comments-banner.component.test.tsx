import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import { WhatsappSocialCommentsBanner } from '../whatsapp-social-comments-banner'

const state = vi.hoisted(() => ({
  comments: [] as unknown[],
  enabled: undefined as boolean | undefined,
  mutate: vi.fn(),
}))
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/hooks/use-whatsapp-meta-channels', () => ({
  useWhatsAppSocialComments: (_w: string, _c: string, enabled: boolean) => {
    state.enabled = enabled
    return { data: enabled ? state.comments : undefined }
  },
  useReplyWhatsAppSocialComment: () => ({
    mutate: state.mutate,
    isPending: false,
  }),
}))

const comment = {
  messageId: 'm1',
  commentId: 'c1',
  postId: 'p1',
  permalink: 'https://www.instagram.com/p/abc/',
  repliedAt: null,
}
const messages = [{ id: 'm1', text: 'quanto custa?' }] as WhatsAppMessageDTO[]

function renderBanner(overrides: { waId?: string; disabled?: boolean } = {}) {
  return render(
    <WhatsappSocialCommentsBanner
      workspaceId='w1'
      conversationId='cv1'
      contactWaId={overrides.waId ?? 'ig:123'}
      messages={messages}
      disabled={overrides.disabled ?? false}
    />,
  )
}

describe('WhatsappSocialCommentsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.comments = [comment]
  })

  it('renders nothing and does not fetch for a WhatsApp conversation', () => {
    const { container } = renderBanner({ waId: '5511999999999' })
    expect(container.innerHTML).toBe('')
    expect(state.enabled).toBe(false)
  })

  it('renders nothing when the conversation has no comments', () => {
    state.comments = []
    const { container } = renderBanner()
    expect(container.innerHTML).toBe('')
  })

  it('shows the comment, its state and the post link', () => {
    renderBanner()
    expect(screen.getByText('quanto custa?')).toBeTruthy()
    expect(screen.getByText('Sem resposta')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Ver publicação' }).getAttribute('href'),
    ).toBe('https://www.instagram.com/p/abc/')
  })

  it('shows replied comments and never links a non-http permalink', () => {
    state.comments = [
      { ...comment, repliedAt: '2026-10-30T10:00:00.000Z', permalink: 'javascript:x' },
    ]
    renderBanner()
    expect(screen.getByText('Respondido')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('sends a public reply and closes the editor on success', async () => {
    state.mutate.mockImplementation((_input, options) => options.onSuccess())
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Responder em público' }))
    fireEvent.change(screen.getByPlaceholderText(/Resposta pública/), {
      target: { value: 'Custa R$ 10' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() =>
      expect(state.mutate).toHaveBeenCalledWith(
        { messageId: 'm1', mode: 'PUBLIC', text: 'Custa R$ 10' },
        expect.any(Object),
      ),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Resposta publicada'),
    )
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Resposta pública/)).toBeNull(),
    )
  })

  it('keeps the editor open when the reply fails', async () => {
    state.mutate.mockImplementation((_input, options) =>
      options.onError(new Error('janela fechada')),
    )
    renderBanner()
    fireEvent.click(
      screen.getByRole('button', { name: 'Responder por mensagem' }),
    )
    fireEvent.change(screen.getByPlaceholderText(/Mensagem direta/), {
      target: { value: 'Te chamei' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(state.mutate).toHaveBeenCalledWith(
      { messageId: 'm1', mode: 'PRIVATE', text: 'Te chamei' },
      expect.any(Object),
    )
    expect(screen.getByPlaceholderText(/Mensagem direta/)).toBeTruthy()
  })

  it('blocks sending while the conversation cannot be answered', () => {
    renderBanner({ disabled: true })
    fireEvent.click(screen.getByRole('button', { name: 'Responder em público' }))
    fireEvent.change(screen.getByPlaceholderText(/Resposta pública/), {
      target: { value: 'oi' },
    })
    expect(
      (screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('cancels the draft', () => {
    renderBanner()
    fireEvent.click(screen.getByRole('button', { name: 'Responder em público' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByPlaceholderText(/Resposta pública/)).toBeNull()
  })
})
