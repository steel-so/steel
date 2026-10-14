import type { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createTestQueryClient,
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import { WhatsappComposer } from '../whatsapp-composer'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u_1' } } }) },
}))
// The real emoji picker renders thousands of emoji; a single button is
// enough to prove the selection lands in the textarea.
vi.mock('@/components/ui/emoji-picker', () => ({
  EmojiPicker: ({
    onEmojiSelect,
  }: {
    onEmojiSelect: (e: { emoji: string }) => void
  }) => (
    <button type='button' onClick={() => onEmojiSelect({ emoji: '🎉' })}>
      emoji-🎉
    </button>
  ),
  EmojiPickerSearch: () => null,
  EmojiPickerContent: () => null,
  EmojiPickerFooter: () => null,
}))

const API = '/api/workspaces/ws_1/whatsapp'
const MESSAGES = `${API}/conversations/cv_1/messages`

function template(
  id: string,
  name: string,
  status: string,
  components: unknown[] = [{ type: 'BODY', text: 'Olá!' }],
) {
  return {
    id,
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    name,
    language: 'pt_BR',
    category: 'UTILITY',
    status,
    components,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function setup(
  extra: FetchRoute[] = [],
  data: { quickReplies?: unknown[]; templates?: unknown[] } = {},
) {
  return mockFetch([
    ...extra,
    {
      match: `${API}/quick-replies`,
      data: data.quickReplies ?? [
        {
          id: 'qr_1',
          shortcut: 'oi',
          title: 'Oi',
          body: 'Olá {nome_cliente}, aqui é {nome_usuario}!',
        },
      ],
    },
    {
      match: `${API}/templates`,
      data: data.templates ?? [
        template('t1', 'boas_vindas', 'APPROVED'),
        template('t2', 'pendente', 'PENDING'),
        template('t3', 'pedido', 'APPROVED', [
          { type: 'BODY', text: 'Pedido {{1}}' },
        ]),
      ],
    },
    {
      match: `${API}/contacts`,
      data: [
        {
          id: 'c1',
          workspaceId: 'ws_1',
          waId: '5511911111111',
          name: 'Carlos',
          avatarUrl: null,
          description: null,
          conversationCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    { match: '/api/users/me', data: { id: 'u_1', name: 'Joana' } },
  ])
}

function renderComposer(
  props: Partial<Parameters<typeof WhatsappComposer>[0]> = {},
  client?: QueryClient,
) {
  const onClearReply = vi.fn()
  const utils = renderWithQuery(
    <WhatsappComposer
      workspaceId='ws_1'
      conversationId='cv_1'
      contactName='Ana'
      onClearReply={onClearReply}
      {...props}
    />,
    { client },
  )
  return { ...utils, onClearReply }
}

const textarea = () =>
  screen.getByPlaceholderText('Digite uma mensagem') as HTMLTextAreaElement
const sendButton = () =>
  screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement

const replyTarget: WhatsAppMessageDTO = {
  id: 'm9',
  workspaceId: 'ws_1',
  conversationId: 'cv_1',
  direction: 'IN',
  type: 'TEXT',
  text: 'Qual o prazo?',
  mediaUrl: null,
  status: 'DELIVERED',
  senderUserId: null,
  sentByAi: false,
  replyToMessageId: null,
  reactionEmoji: null,
  reactedByContact: null,
  contactPayload: null,
  buttons: null,
  buttonPayload: null,
  createdAt: '2026-01-01T12:00:00.000Z',
}

describe('<WhatsappComposer /> text', () => {
  it('keeps send disabled until there is non-blank text', () => {
    setup()
    renderComposer()
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(textarea(), { target: { value: '   ' } })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(textarea(), { target: { value: 'Oi' } })
    expect(sendButton().disabled).toBe(false)
  })

  it('sends trimmed text and clears the input', async () => {
    const fetchSpy = setup([{ method: 'POST', match: MESSAGES, data: {} }])
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '  Bom dia!  ' } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(textarea().value).toBe(''))
    expect(fetchBody(fetchSpy, MESSAGES)).toEqual({ text: 'Bom dia!' })
  })

  it('sends on Enter but not on Shift+Enter', async () => {
    const fetchSpy = setup([{ method: 'POST', match: MESSAGES, data: {} }])
    renderComposer()

    fireEvent.change(textarea(), { target: { value: 'linha 1' } })
    fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: true })
    expect(fetchBody(fetchSpy, MESSAGES)).toBeUndefined()

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(fetchBody(fetchSpy, MESSAGES)).toEqual({ text: 'linha 1' }),
    )
  })

  it('keeps the draft and warns when sending fails', async () => {
    setup([{ method: 'POST', match: MESSAGES, status: 500, error: 'x' }])
    renderComposer()

    fireEvent.change(textarea(), { target: { value: 'Oi' } })
    fireEvent.click(sendButton())

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Erro ao enviar mensagem'),
    )
    expect(textarea().value).toBe('Oi')
  })

  it('is fully locked when disabled (AI handling the chat)', () => {
    setup()
    renderComposer({ disabled: true })
    expect(textarea().disabled).toBe(true)
    for (const name of ['Mensagem rápida', 'Template', 'Emoji', 'Anexo']) {
      expect(
        (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
      ).toBe(true)
    }
  })

  it('quotes the reply target and sends it as replyToMessageId', async () => {
    const fetchSpy = setup([{ method: 'POST', match: MESSAGES, data: {} }])
    const { onClearReply } = renderComposer({ replyTarget })

    expect(screen.getByText('Respondendo')).toBeTruthy()
    expect(screen.getByText('Qual o prazo?')).toBeTruthy()

    fireEvent.change(textarea(), { target: { value: 'Amanhã' } })
    fireEvent.click(sendButton())
    await waitFor(() => expect(onClearReply).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, MESSAGES)).toEqual({
      text: 'Amanhã',
      replyToMessageId: 'm9',
    })
  })

  it('cancels the reply', () => {
    setup()
    const { onClearReply } = renderComposer({ replyTarget })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar resposta' }))
    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('appends a picked emoji to the draft', async () => {
    setup()
    renderComposer()
    fireEvent.change(textarea(), { target: { value: 'Parabéns ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Emoji' }))
    fireEvent.click(await screen.findByText('emoji-🎉'))
    expect(textarea().value).toBe('Parabéns 🎉')
  })
})

describe('<WhatsappComposer /> quick replies and templates', () => {
  it('inserts a quick reply with contact and agent names resolved', async () => {
    setup()
    const client = createTestQueryClient()
    // Seed the signed-in user (`useUser` key) so {nome_usuario} resolves.
    client.setQueryData([['user'], 'u_1'], { id: 'u_1', name: 'Joana' })
    renderComposer({}, client)

    fireEvent.change(textarea(), { target: { value: 'Oi! ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mensagem rápida' }))
    fireEvent.click(await screen.findByText('/oi'))

    expect(textarea().value).toBe('Oi! Olá Ana, aqui é Joana!')
    // Popover closes after picking.
    await waitFor(() => expect(screen.queryByText('/oi')).toBeNull())
  })

  it('shows an empty state without quick replies', async () => {
    setup([], { quickReplies: [] })
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Mensagem rápida' }))
    expect(
      await screen.findByText('Nenhuma mensagem rápida cadastrada'),
    ).toBeTruthy()
  })

  it('sends a template without variables directly and blocks unapproved ones', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${MESSAGES}/template`, data: {} },
    ])
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Template' }))
    const pending = await screen.findByRole('button', { name: /pendente/ })
    expect((pending as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /boas_vindas/ }))
    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${MESSAGES}/template`)).toEqual({
        templateName: 'boas_vindas',
        language: 'pt_BR',
      }),
    )
  })

  it('asks for variables before sending a template that has them', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${MESSAGES}/template`, data: {} },
    ])
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Template' }))
    fireEvent.click(await screen.findByRole('button', { name: /^pedido/ }))

    const dialog = await screen.findByRole('dialog')
    expect(fetchBody(fetchSpy, `${MESSAGES}/template`)).toBeUndefined()
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '#42' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${MESSAGES}/template`)).toEqual({
        templateName: 'pedido',
        language: 'pt_BR',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '#42' }] },
        ],
      }),
    )
  })

  it('shows an empty state without templates', async () => {
    setup([], { templates: [] })
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Template' }))
    expect(await screen.findByText('Nenhum template sincronizado')).toBeTruthy()
  })
})

describe('<WhatsappComposer /> attachments and contacts', () => {
  function fileInput(container: HTMLElement) {
    // Third hidden input is the generic "Arquivo" picker (no accept filter).
    return container.querySelectorAll(
      'input[type="file"]',
    )[2] as HTMLInputElement
  }

  it('uploads a staged file and sends it with the text as caption', async () => {
    const fetchSpy = setup([
      {
        method: 'POST',
        match: `${API}/media/upload`,
        data: { url: 'https://cdn/x.pdf' },
      },
      { method: 'POST', match: `${MESSAGES}/media`, data: {} },
    ])
    const { container } = renderComposer()

    const file = new File(['%PDF'], 'contrato.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(fileInput(container), { target: { files: [file] } })

    expect(await screen.findByText('contrato.pdf')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('4 B')).toBeTruthy())
    expect(sendButton().disabled).toBe(false)

    fireEvent.change(textarea(), { target: { value: 'Segue o contrato' } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(screen.queryByText('contrato.pdf')).toBeNull())
    expect(fetchBody(fetchSpy, `${MESSAGES}/media`)).toEqual({
      mediaUrl: 'https://cdn/x.pdf',
      type: 'DOCUMENT',
      fileName: 'contrato.pdf',
      caption: 'Segue o contrato',
    })
  })

  it('marks a failed upload and keeps send disabled', async () => {
    setup([
      { method: 'POST', match: `${API}/media/upload`, status: 500, error: 'x' },
    ])
    const { container } = renderComposer()
    fireEvent.change(fileInput(container), {
      target: { files: [new File(['a'], 'foto.txt', { type: 'text/plain' })] },
    })

    expect(await screen.findByText('Falha no envio')).toBeTruthy()
    expect(notify.error).toHaveBeenCalledWith('Erro ao enviar arquivo')
    expect(sendButton().disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Remover anexo' }))
    expect(screen.queryByText('foto.txt')).toBeNull()
  })

  it('shares a saved contact from the attachment menu', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${MESSAGES}/contact`, data: {} },
    ])
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Anexo' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Contato/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      await within(dialog).findByRole('button', { name: /Carlos/ }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${MESSAGES}/contact`)).toEqual({
        contactId: 'c1',
      }),
    )
  })

  it('warns when the microphone is unavailable', async () => {
    setup()
    renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Gravar áudio' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Não foi possível acessar o microfone',
      ),
    )
  })
})

describe('<WhatsappComposer /> slash quick replies', () => {
  const SLASH_REPLIES = [
    {
      id: 'qr_1',
      shortcut: 'saudacao-tarde',
      title: 'Boa tarde',
      body: 'Boa tarde, {nome_cliente}!',
      mediaUrl: null,
    },
    {
      // Saved with the slash and an accent: `/saudacao` must still find it.
      id: 'qr_2',
      shortcut: '/Saudação',
      title: 'Saudação',
      body: 'Olá {nome_cliente}, tudo bem?',
      mediaUrl: null,
    },
    {
      id: 'qr_3',
      shortcut: 'tabela',
      title: 'Tabela de preços',
      body: 'Segue a tabela, {nome_cliente}.',
      mediaUrl: 'https://cdn.test/media/ws_1/tabela.pdf',
    },
    {
      id: 'qr_4',
      shortcut: 'logo',
      title: 'Logo',
      body: 'Nossa marca',
      mediaUrl: 'https://cdn.test/media/ws_1/logo.png',
    },
  ]

  type Spy = ReturnType<typeof setup>
  const bodiesOf = (spy: Spy, suffix: string) =>
    spy.mock.calls
      .filter(
        ([url, init]) =>
          String(url).endsWith(suffix) && init?.method === 'POST',
      )
      .map(([, init]) => JSON.parse(String(init?.body)))
  const textCalls = (spy: Spy) => bodiesOf(spy, MESSAGES)
  const mediaCalls = (spy: Spy) => bodiesOf(spy, `${MESSAGES}/media`)

  function setupSlash(extra: FetchRoute[] = []) {
    return setup(
      [
        ...extra,
        { method: 'POST', match: `${MESSAGES}/media`, data: {} },
        { method: 'POST', match: MESSAGES, data: {} },
      ],
      { quickReplies: SLASH_REPLIES },
    )
  }

  it('lists the exact shortcut first and expands it on Enter', async () => {
    const spy = setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/saudacao' } })
    const list = await screen.findByRole('listbox', {
      name: 'Mensagens rápidas',
    })
    const options = within(list).getAllByRole('option')
    expect(options[0].textContent).toContain('/Saudação')
    expect(options[0].getAttribute('aria-selected')).toBe('true')
    expect(textarea().getAttribute('aria-controls')).toBe(
      'whatsapp-quick-reply-list',
    )

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(textarea().value).toBe('Olá Ana, tudo bem?')
    expect(screen.queryByRole('listbox')).toBeNull()
    // Expanding is not sending: the agent reviews, then Enter sends.
    expect(textCalls(spy)).toEqual([])

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(textCalls(spy)).toEqual([{ text: 'Olá Ana, tudo bem?' }]),
    )
  })

  it('moves through the matches with the arrows and applies with Tab', async () => {
    setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/sauda' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    fireEvent.keyDown(textarea(), { key: 'ArrowDown' })
    fireEvent.keyDown(textarea(), { key: 'ArrowUp' })
    const selected = screen
      .getAllByRole('option')
      .find((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected?.textContent).toContain('/Saudação')

    fireEvent.keyDown(textarea(), { key: 'Tab' })
    expect(textarea().value).toBe('Olá Ana, tudo bem?')
  })

  it('closes the picker on Escape and then sends the literal text', async () => {
    const spy = setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/sauda' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() => expect(textCalls(spy)).toEqual([{ text: '/sauda' }]))
  })

  it('applies an entry picked with the mouse', async () => {
    setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/' } })
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option')).toHaveLength(4)
    fireEvent.mouseDown(within(list).getByText('/saudacao-tarde'))
    fireEvent.click(within(list).getByText('/saudacao-tarde'))
    expect(textarea().value).toBe('Boa tarde, Ana!')
  })

  it('sends the expanded reply when the send button gets an exact shortcut', async () => {
    const spy = setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/saudacao' } })
    await screen.findByRole('listbox')
    fireEvent.click(sendButton())

    await waitFor(() =>
      expect(textCalls(spy)).toEqual([{ text: 'Olá Ana, tudo bem?' }]),
    )
    await waitFor(() => expect(textarea().value).toBe(''))
  })

  it('stages the media of a quick reply and sends it with the text as caption', async () => {
    const spy = setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/tabela' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(textarea(), { key: 'Enter' })

    expect(textarea().value).toBe('Segue a tabela, Ana.')
    expect(screen.getByText('tabela.pdf')).toBeTruthy()
    expect(screen.getByText('Anexo da mensagem rápida')).toBeTruthy()

    fireEvent.click(sendButton())
    await waitFor(() =>
      expect(mediaCalls(spy)).toEqual([
        {
          mediaUrl: 'https://cdn.test/media/ws_1/tabela.pdf',
          type: 'DOCUMENT',
          fileName: 'tabela.pdf',
          caption: 'Segue a tabela, Ana.',
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByText('tabela.pdf')).toBeNull())
    expect(textCalls(spy)).toEqual([])
  })

  it('sends the media of an exact shortcut straight from the send button', async () => {
    const spy = setupSlash()
    renderComposer()

    fireEvent.change(textarea(), { target: { value: '/logo' } })
    await screen.findByRole('listbox')
    fireEvent.click(sendButton())

    await waitFor(() =>
      expect(mediaCalls(spy)).toEqual([
        {
          mediaUrl: 'https://cdn.test/media/ws_1/logo.png',
          type: 'IMAGE',
          fileName: 'logo.png',
          caption: 'Nossa marca',
        },
      ]),
    )
    await waitFor(() => expect(textarea().value).toBe(''))
  })

  it('stages the media once when the same reply is picked twice', async () => {
    setupSlash()
    renderComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Mensagem rápida' }))
    fireEvent.click(await screen.findByText('/logo'))
    fireEvent.click(screen.getByRole('button', { name: 'Mensagem rápida' }))
    fireEvent.click(await screen.findByText('/logo'))

    expect(screen.getAllByText('logo.png')).toHaveLength(1)
    expect(textarea().value).toBe('Nossa marcaNossa marca')
  })

  it('sends a caption over the WhatsApp limit as a separate text', async () => {
    const spy = setupSlash([
      {
        method: 'POST',
        match: `${API}/media/upload`,
        data: { url: 'https://cdn/x.pdf' },
      },
    ])
    const { container } = renderComposer()
    const input = container.querySelectorAll(
      'input[type="file"]',
    )[2] as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })],
      },
    })
    await waitFor(() => expect(screen.getByText('4 B')).toBeTruthy())

    const long = 'x'.repeat(1100)
    fireEvent.change(textarea(), { target: { value: long } })
    fireEvent.click(sendButton())

    await waitFor(() => expect(textCalls(spy)).toEqual([{ text: long }]))
    expect(mediaCalls(spy)).toEqual([
      { mediaUrl: 'https://cdn/x.pdf', type: 'DOCUMENT', fileName: 'a.pdf' },
    ])
  })
})
