import { fireEvent, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmEmailCampaignsTable } from '../crm-email-campaigns-table'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

vi.mock('@/src/hooks/use-crm-workspace-lookups', () => ({
  useCrmWorkspaceLookups: () => ({ lookups: undefined }),
}))

// The generic grid is covered elsewhere; here it is a thin stub that exposes
// the header action and lets a test "open" a record row.
vi.mock('@/app/_components/crm/table/data-table', () => ({
  DataTable: (props: {
    data: { id: string; subject: string }[]
    isLoading: boolean
    headerAction?: React.ReactNode
    onOpenRecord?: (r: { id: string }) => void
  }) => (
    <div>
      {props.headerAction}
      {props.isLoading ? <p>grid-loading</p> : null}
      {props.data.map((row) => (
        <button
          key={row.id}
          type='button'
          onClick={() => props.onOpenRecord?.(row)}
        >
          abrir {row.subject}
        </button>
      ))}
    </div>
  ),
}))

// The sender picker has its own test (email-sender-picker.component.test).
vi.mock('@/app/_components/crm/email-sender-picker', () => ({
  EmailSenderPicker: (props: {
    value: string
    onChange: (email: string) => void
  }) => (
    <input
      aria-label='Remetente'
      placeholder='contato@suaempresa.com'
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))

const editor = vi.hoisted(() => ({ html: '<p>Olá</p>' }))
vi.mock('@/app/_components/crm/email-editor-shell', () => ({
  EmailEditorShell: forwardRef(function EditorStub(
    props: { initialContent?: string },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      getEmailHTML: async () => editor.html,
      getJSON: () => ({ type: 'doc' }),
    }))
    return <div data-testid='editor'>{props.initialContent ?? ''}</div>
  }),
}))

const CAMPAIGN = {
  id: 'c1',
  subject: 'Promo de junho',
  contentHtml: '<p>Conteúdo da promo</p>',
  contentJson: null,
  fromAddress: 'mkt@acme.com',
  status: 'SENT',
  recipientScope: 'ALL',
  recipientCount: 10,
  sentCount: 9,
  failedCount: 1,
  scheduledAt: null,
  sentAt: null,
  workspaceId: WS,
  createdById: 'u1',
  createdAt: '2026-06-01T00:00:00.000Z',
}

const PEOPLE = [
  { id: 'p1', name: 'Ana', emails: ['ana@acme.com'], phones: [] },
  { id: 'p2', name: 'Bruno', emails: ['bruno@acme.com'], phones: [] },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([
    ...extra,
    {
      method: 'POST',
      match: /email-campaigns$/,
      data: { ...CAMPAIGN, id: 'new1' },
    },
    { method: 'POST', match: '/email-campaigns/new1/send', data: CAMPAIGN },
    { match: '/email-campaigns/c1/recipients', data: [] },
    { match: '/crm/email-campaigns', data: [CAMPAIGN] },
    { match: '/crm/email-templates', data: [] },
    { match: '/crm/people', data: PEOPLE },
    { match: '/crm/mailing-lists', data: [] },
  ])
  renderWithQuery(<CrmEmailCampaignsTable workspaceId={WS} slug='acme' />)
  return spy
}

async function openComposer() {
  fireEvent.click(screen.getByRole('button', { name: /nova campanha/i }))
  return screen.findByPlaceholderText('Novidades de junho')
}

function fill(subject: string, from: string) {
  fireEvent.change(screen.getByPlaceholderText('Novidades de junho'), {
    target: { value: subject },
  })
  fireEvent.change(screen.getByPlaceholderText('contato@suaempresa.com'), {
    target: { value: from },
  })
}

describe('<CrmEmailCampaignsTable /> composer', () => {
  beforeEach(() => {
    editor.html = '<p>Olá</p>'
  })

  it('requires subject and sender before submitting', async () => {
    const spy = setup()
    await openComposer()

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Informe o assunto'),
    )

    fireEvent.change(screen.getByPlaceholderText('Novidades de junho'), {
      target: { value: 'Oferta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Informe o remetente'),
    )
    expect(fetchBody(spy, /email-campaigns$/)).toBeUndefined()
  })

  it('rejects an empty editor body', async () => {
    editor.html = '   '
    const spy = setup()
    await openComposer()
    fill('Oferta', 'mkt@acme.com')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Conteúdo vazio'),
    )
    expect(fetchBody(spy, /email-campaigns$/)).toBeUndefined()
  })

  it('requires at least one recipient when nothing is selected', async () => {
    setup()
    await openComposer()
    fill('Oferta', 'mkt@acme.com')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Desmarcar todos' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Selecione ao menos um destinatário',
      ),
    )
  })

  it('creates and immediately sends an ALL-scope campaign', async () => {
    const spy = setup()
    await openComposer()
    fill('Oferta', 'mkt@acme.com')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Campanha enviada'),
    )
    const body = fetchBody(spy, /email-campaigns$/)
    expect(body).toMatchObject({
      subject: 'Oferta',
      fromAddress: 'mkt@acme.com',
      contentHtml: '<p>Olá</p>',
      recipientScope: 'ALL',
    })
    expect(body.personIds).toBeUndefined()
    expect(body.scheduledAt).toBeUndefined()
    expect(spy.mock.calls.some(([u]) => String(u).endsWith('/new1/send'))).toBe(
      true,
    )
  })

  it('sends SELECTED recipients with person ids', async () => {
    const spy = setup()
    await openComposer()
    fill('Oferta', 'mkt@acme.com')
    const ana = (await screen.findByText('Ana'))
      .closest('label')
      ?.querySelector('input') as HTMLInputElement
    fireEvent.click(ana)

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
    expect(fetchBody(spy, /email-campaigns$/)).toMatchObject({
      recipientScope: 'SELECTED',
      personIds: ['p2'],
      mailingListIds: [],
      extraEmails: [],
    })
  })

  it('validates the schedule date and schedules without sending', async () => {
    const spy = setup()
    await openComposer()
    fill('Oferta', 'mkt@acme.com')

    fireEvent.click(screen.getByLabelText('Enviar mais tarde'))
    const submit = screen.getByRole('button', { name: 'Agendar envio' })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Informe a data e hora do agendamento',
      ),
    )

    const dateInput = document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2000-01-01T10:00' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Data de agendamento deve ser no futuro',
      ),
    )

    fireEvent.change(dateInput, { target: { value: '2999-01-01T10:00' } })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Campanha agendada'),
    )
    expect(fetchBody(spy, /email-campaigns$/)?.scheduledAt).toBe(
      new Date('2999-01-01T10:00').toISOString(),
    )
    expect(spy.mock.calls.some(([u]) => String(u).endsWith('/send'))).toBe(
      false,
    )
  })

  it('surfaces the API error and keeps the composer open', async () => {
    setup([
      {
        method: 'POST',
        match: /email-campaigns$/,
        status: 422,
        error: 'Remetente não verificado',
      },
    ])
    await openComposer()
    fill('Oferta', 'mkt@acme.com')

    fireEvent.click(screen.getByRole('button', { name: 'Enviar agora' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.lastCall?.[0] as Error)?.message).toBe(
      'Remetente não verificado',
    )
    expect(screen.getByPlaceholderText('Novidades de junho')).toBeTruthy()
  })
})

describe('<CrmEmailCampaignsTable /> detail', () => {
  it('shows campaign metrics and recipient statuses', async () => {
    setup([
      {
        match: '/email-campaigns/c1/recipients',
        data: [
          {
            id: 'r1',
            email: 'ana@acme.com',
            name: 'Ana',
            status: 'SENT',
            errorMessage: null,
          },
          {
            id: 'r2',
            email: 'x@acme.com',
            name: null,
            status: 'FAILED',
            errorMessage: 'Caixa cheia',
          },
        ],
      },
    ])
    fireEvent.click(
      await screen.findByRole('button', { name: 'abrir Promo de junho' }),
    )

    expect(await screen.findByText('Destinatários (2)')).toBeTruthy()
    expect(screen.getByText('mkt@acme.com')).toBeTruthy()
    expect(screen.getByText('Enviada')).toBeTruthy()
    expect(screen.getByText('Conteúdo da promo')).toBeTruthy()
    expect(screen.getByText('Enviado')).toBeTruthy()
    expect(screen.getByText('Falhou')).toBeTruthy()
    expect(screen.getByText('Caixa cheia')).toBeTruthy()
  })
})
