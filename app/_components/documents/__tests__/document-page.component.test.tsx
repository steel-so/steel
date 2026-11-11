import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { DocumentDTO, DocumentEventDTO } from '@/types/document'
import { describeDocumentEvent } from '../document-activity'
import { DocumentPage } from '../document-page'
import { BASE, fakeDocument, fakeRecipient, SLUG, WS } from './fixtures'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/app/_components/documents/import/document-import-dialog', () => ({
  DocumentImportDialog: () => null,
}))
vi.mock('@/app/_components/documents/export/document-export-button', () => ({
  DocumentExportButton: () => <button type='button'>Exportar PDF</button>,
}))
vi.mock(
  '@/app/_components/documents/analytics/document-analytics-panel',
  () => ({
    DocumentAnalyticsPanel: ({ isTemplate }: { isTemplate?: boolean }) => (
      <div data-testid='analytics-panel'>{isTemplate ? 'modelo' : 'doc'}</div>
    ),
  }),
)

function event(
  type: string,
  overrides: Partial<DocumentEventDTO> = {},
): DocumentEventDTO {
  return {
    id: `e_${type}`,
    type,
    recipient: null,
    actor: null,
    data: {},
    createdAt: '2026-11-10T15:00:00.000Z',
    ...overrides,
  }
}

const EVENTS = [
  event('SENT', {
    actor: { id: 'u1', name: 'João Lima' },
    data: { versionNumber: 1 },
    createdAt: '2026-11-10T13:00:00.000Z',
  }),
  event('OPENED', { recipient: { id: 'r1', name: 'Maria Souza' } }),
]

function setup(doc: DocumentDTO = fakeDocument()) {
  const spy = mockFetch([
    { match: `${BASE}/doc_1/events`, data: EVENTS },
    {
      match: `${BASE}/doc_1/versions`,
      data: [doc.currentVersion].filter(Boolean),
    },
    {
      match: `${BASE}/doc_1/responses`,
      data: [
        {
          id: 'resp_1',
          action: 'SUBMIT',
          name: 'Maria Souza',
          email: 'maria@acme.com.br',
          recipientId: 'r1',
          versionNumber: 1,
          fields: { f1: '11.222.333/0001-81' },
          selection: { i1: { selected: true, quantity: 2 } },
          totalValue: 2000,
          reason: null,
          createdAt: '2026-11-10T16:00:00.000Z',
        },
      ],
    },
    { match: '/crm/companies', data: [] },
    { match: '/crm/people', data: [] },
    { match: '/crm/opportunities', data: [] },
    { match: '/crm/leads', data: [] },
    {
      method: 'PATCH',
      match: new RegExp(`${BASE}/doc_1$`),
      data: { ...doc, status: 'ARCHIVED' },
    },
    {
      method: 'POST',
      match: `${BASE}/doc_1/duplicate`,
      status: 201,
      data: fakeDocument({ id: 'tpl_9', isTemplate: true }),
    },
    { match: new RegExp(`${BASE}/doc_1$`), data: doc },
  ])
  renderWithQuery(
    <DocumentPage workspaceId={WS} slug={SLUG} documentId='doc_1' />,
  )
  return spy
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('describeDocumentEvent', () => {
  it('writes each event as a pt-BR sentence', () => {
    expect(describeDocumentEvent(EVENTS[0])).toBe(
      'João Lima enviou o documento (versão 1)',
    )
    expect(describeDocumentEvent(EVENTS[1])).toBe(
      'Maria Souza abriu o documento',
    )
    expect(describeDocumentEvent(event('EXPIRED'))).toBe('O documento expirou')
    expect(
      describeDocumentEvent(
        event('LINK_CLICKED', { data: { target: 'https://acme.com' } }),
      ),
    ).toBe('Um visitante clicou em um link: https://acme.com')
    expect(
      describeDocumentEvent(
        event('DECLINED', {
          recipient: { id: 'r1', name: 'Maria' },
          data: { reason: 'Caro demais' },
        }),
      ),
    ).toBe('Maria recusou o documento — “Caro demais”')
  })
})

describe('<DocumentPage />', () => {
  it('shows the header, recipients, link and responses', async () => {
    setup()
    expect(
      await screen.findByRole('heading', { name: 'Proposta — Acme' }),
    ).toBeTruthy()
    expect(screen.getByText('Enviado')).toBeTruthy()
    expect(screen.getByText('João Lima')).toBeTruthy()
    expect(screen.getByText(/48\.000,00/)).toBeTruthy()
    expect(screen.getByTestId('document-page-send').textContent).toContain(
      'Enviar',
    )

    const recipient = screen.getByTestId('document-recipient-r1')
    expect(within(recipient).getByText('Maria Souza')).toBeTruthy()
    expect(within(recipient).getByText('Abriu')).toBeTruthy()
    expect(
      within(recipient).getByRole('button', {
        name: 'Copiar link de Maria Souza',
      }),
    ).toBeTruthy()
    expect(
      within(recipient).getByRole('button', {
        name: 'Reenviar para Maria Souza',
      }),
    ).toBeTruthy()
    expect(
      screen.getByText('https://steel.example.com/d/tok_public'),
    ).toBeTruthy()

    const response = await screen.findByTestId('document-response')
    expect(within(response).getByText('CNPJ da empresa')).toBeTruthy()
    expect(within(response).getByText('11.222.333/0001-81')).toBeTruthy()
    expect(within(response).getByText('Implantação')).toBeTruthy()
    expect(within(response).getByText('× 2')).toBeTruthy()
  })

  it('asks to update the version when the draft changed', async () => {
    setup(fakeDocument({ hasUnsentChanges: true }))
    const button = await screen.findByTestId('document-page-send')
    expect(button.textContent).toContain('Atualizar versão')
    expect(
      screen.getByText(/Há alterações no rascunho que o leitor ainda não vê/),
    ).toBeTruthy()
    fireEvent.click(button)
    expect(
      await screen.findByRole('heading', { name: 'Atualizar versão' }),
    ).toBeTruthy()
  })

  it('shows who accepted', async () => {
    setup(
      fakeDocument({
        status: 'ACCEPTED',
        acceptedAt: '2026-11-11T12:00:00.000Z',
        acceptedByName: 'Maria Souza',
        acceptedByEmail: 'maria@acme.com.br',
        recipients: [fakeRecipient({ status: 'ACCEPTED' })],
      }),
    )
    expect(await screen.findByText('Aceito')).toBeTruthy()
    expect(screen.getByText('Maria Souza · maria@acme.com.br')).toBeTruthy()
  })

  it('archives from the menu', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Arquivar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Documento arquivado.'),
    )
    expect(fetchBody(spy, `${BASE}/doc_1`, 'PATCH')).toEqual({
      status: 'ARCHIVED',
    })
  })

  it('saves a copy as a template', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações' }))
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Salvar como modelo' }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/tpl_9'),
    )
    expect(fetchBody(spy, `${BASE}/doc_1/duplicate`)).toEqual({
      asTemplate: true,
    })
  })

  it('shows the activity, versions and analytics tabs', async () => {
    setup()
    await screen.findByRole('heading', { name: 'Proposta — Acme' })
    fireEvent.click(screen.getByRole('tab', { name: 'Atividade' }))
    expect(
      await screen.findByText('Maria Souza abriu o documento'),
    ).toBeTruthy()
    expect(screen.getAllByTestId('document-event')).toHaveLength(2)

    fireEvent.click(screen.getByRole('tab', { name: 'Versões' }))
    const version = await screen.findByTestId('document-version')
    expect(within(version).getByText('Versão 1')).toBeTruthy()
    expect(within(version).getByText('Atual')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Analytics' }))
    expect((await screen.findByTestId('analytics-panel')).textContent).toBe(
      'doc',
    )
  })

  it('treats a template as a template', async () => {
    setup(
      fakeDocument({
        isTemplate: true,
        status: 'DRAFT',
        currentVersion: null,
        recipients: [],
      }),
    )
    expect(await screen.findByText('Sobre este modelo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Usar modelo' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Atividade' })).toBeNull()
    expect(screen.queryByTestId('document-page-send')).toBeNull()
  })

  it('explains a missing document', async () => {
    mockFetch([
      { match: new RegExp(`${BASE}/doc_1$`), status: 404, error: 'Não achei' },
    ])
    renderWithQuery(
      <DocumentPage workspaceId={WS} slug={SLUG} documentId='doc_1' />,
    )
    expect(
      await screen.findByText(
        'Este documento não existe mais ou você não tem acesso a ele.',
      ),
    ).toBeTruthy()
  })
})
