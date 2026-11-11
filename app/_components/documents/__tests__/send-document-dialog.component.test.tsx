import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { DocumentDTO } from '@/types/document'
import { SendDocumentDialog } from '../send-document-dialog'
import { BASE, fakeDocument, fakeRecipient, WS } from './fixtures'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const PEOPLE = [
  {
    id: 'p2',
    name: 'Carlos Pereira',
    emails: ['carlos@acme.com.br'],
    phones: [],
  },
  { id: 'p3', name: 'Beatriz Ramos', emails: [], phones: ['11988887777'] },
]

const SENT = fakeDocument({
  recipients: [
    fakeRecipient(),
    fakeRecipient({
      id: 'r2',
      name: 'Carlos Pereira',
      email: 'carlos@acme.com.br',
      status: 'PENDING',
      url: 'https://steel.example.com/d/tok_carlos',
    }),
  ],
})

function setup(document: DocumentDTO, beforeSend?: () => Promise<boolean>) {
  const onSent = vi.fn()
  const spy = mockFetch([
    { match: '/crm/people', data: PEOPLE },
    { method: 'POST', match: `${BASE}/doc_1/send`, data: SENT },
  ])
  renderWithQuery(
    <SendDocumentDialog
      workspaceId={WS}
      document={document}
      open
      onOpenChange={vi.fn()}
      beforeSend={beforeSend}
      onSent={onSent}
    />,
  )
  return { spy, onSent }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<SendDocumentDialog />', () => {
  it('sends to a CRM person and shows the links', async () => {
    const draft = fakeDocument({
      status: 'DRAFT',
      currentVersion: null,
      person: null,
      recipients: [],
    })
    const beforeSend = vi.fn(async () => true)
    const { spy, onSent } = setup(draft, beforeSend)
    expect(
      await screen.findByRole('heading', { name: 'Enviar documento' }),
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Buscar pessoa do CRM'), {
      target: { value: 'carl' },
    })
    fireEvent.click(await screen.findByRole('button', { name: /Carlos/ }))
    const row = screen.getByTestId('send-recipient')
    const name = within(row).getByLabelText('Nome') as HTMLInputElement
    expect(name.value).toBe('Carlos Pereira')
    fireEvent.change(screen.getByLabelText('Mensagem (opcional)'), {
      target: { value: 'Segue a proposta.' },
    })
    fireEvent.click(screen.getByTestId('send-document-submit'))

    expect(
      await screen.findByRole('heading', { name: 'Pronto, links gerados' }),
    ).toBeTruthy()
    expect(beforeSend).toHaveBeenCalled()
    expect(onSent).toHaveBeenCalledWith(SENT)
    expect(fetchBody(spy, `${BASE}/doc_1/send`)).toMatchObject({
      recipients: [
        {
          name: 'Carlos Pereira',
          email: 'carlos@acme.com.br',
          personId: 'p2',
          role: 'APPROVER',
          channel: 'EMAIL',
        },
      ],
      message: 'Segue a proposta.',
    })
    expect(screen.getByText(SENT.publicUrl)).toBeTruthy()
    const links = screen.getByRole('list', { name: 'Links pessoais' })
    expect(within(links).getByText('Carlos Pereira')).toBeTruthy()
    expect(
      within(links).getByRole('button', {
        name: 'Copiar link de Carlos Pereira',
      }),
    ).toBeTruthy()
  })

  it('refuses an e-mail recipient without an address', async () => {
    const { spy } = setup(
      fakeDocument({ currentVersion: null, person: null, recipients: [] }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar manualmente' }),
    )
    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Ana' },
    })
    fireEvent.click(screen.getByTestId('send-document-submit'))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Informe o e-mail para enviar por e-mail',
      ),
    )
    expect(fetchBody(spy, `${BASE}/doc_1/send`)).toBeUndefined()
  })

  it('updates the version of a sent document', async () => {
    const { spy } = setup(
      fakeDocument({ hasUnsentChanges: true, person: null }),
    )
    expect(
      await screen.findByRole('heading', { name: 'Atualizar versão' }),
    ).toBeTruthy()
    expect(screen.getByText('Novos destinatários (opcional)')).toBeTruthy()
    fireEvent.click(screen.getByTestId('send-document-submit'))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Nova versão enviada.'),
    )
    expect(fetchBody(spy, `${BASE}/doc_1/send`)).toMatchObject({
      recipients: [],
    })
  })

  it('stops when saving the draft fails', async () => {
    const beforeSend = vi.fn(async () => false)
    const { spy } = setup(
      fakeDocument({ currentVersion: null, person: null, recipients: [] }),
      beforeSend,
    )
    fireEvent.click(await screen.findByTestId('send-document-submit'))
    await waitFor(() => expect(beforeSend).toHaveBeenCalled())
    expect(fetchBody(spy, `${BASE}/doc_1/send`)).toBeUndefined()
    expect(
      screen.getByRole('heading', { name: 'Enviar documento' }),
    ).toBeTruthy()
  })
})
