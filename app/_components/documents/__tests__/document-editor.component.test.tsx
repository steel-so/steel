import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasEditorProps } from '@/app/_components/canvas/types'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { DocumentEditor } from '../editor/document-editor'
import { BASE, fakeDocument, SLUG, WS } from './fixtures'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
const catalogState = vi.hoisted(() => ({ available: true }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/app/_components/documents/export/document-export-button', () => ({
  DocumentExportButton: () => <button type='button'>Exportar PDF</button>,
}))
vi.mock('@/src/lib/canvas-document', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  createDocumentCatalog: () => {
    if (!catalogState.available) throw new Error('not ready')
    return { id: 'document' }
  },
  validateDocumentContent: (input: unknown) => ({ ok: true, value: input }),
  DocumentView: () => <div>prévia</div>,
}))
vi.mock('@/src/lib/canvas/store', () => ({
  createCanvasStore: (_catalog: unknown, doc: unknown) => {
    const state = { doc, dirty: true }
    return {
      getState: () => state,
      reset: (next: unknown) => {
        state.doc = next
      },
      markSaved: () => {
        state.dirty = false
      },
      subscribe: () => () => {},
    }
  },
}))
vi.mock('@/app/_components/canvas/editor-context', () => ({
  useCanvasEditor: () => ({ save: async () => true }),
}))
/** The shell, reduced to what the document editor hands it. */
vi.mock('@/app/_components/canvas/canvas-editor', () => ({
  CanvasEditor: (props: CanvasEditorProps) => {
    const store = props.store as NonNullable<CanvasEditorProps['store']>
    return (
      <div>
        <div data-testid='editor-title'>{props.title as ReactNode}</div>
        <div>{props.actions?.({ store })}</div>
        <div>{props.documentSettings?.({ store })}</div>
        <span data-testid='viewport'>{props.viewportWidths.base}</span>
        <button
          type='button'
          onClick={() => void props.onSave(store.getState().doc)}
        >
          salvar agora
        </button>
      </div>
    )
  },
}))

const DOC = fakeDocument({ updatedAt: '2026-11-10T13:00:00.000Z' })

function setup(saveStatus = 200) {
  const spy = mockFetch([
    { match: '/crm/people', data: [] },
    {
      method: 'PUT',
      match: `${BASE}/doc_1/content`,
      handler: () =>
        saveStatus === 409
          ? new Response(
              JSON.stringify({
                success: false,
                message: 'Conflito',
                error: { code: 'DOCUMENT_SAVE_CONFLICT' },
              }),
              { status: 409 },
            )
          : { updatedAt: '2026-11-10T14:00:00.000Z' },
    },
    {
      method: 'PATCH',
      match: new RegExp(`${BASE}/doc_1$`),
      handler: (_url, init) => ({
        ...DOC,
        ...JSON.parse(String(init?.body)),
        updatedAt: '2026-11-10T15:00:00.000Z',
      }),
    },
    { match: new RegExp(`${BASE}/doc_1$`), data: DOC },
  ])
  renderWithQuery(
    <DocumentEditor workspaceId={WS} slug={SLUG} documentId='doc_1' />,
  )
  return spy
}

function puts(spy: ReturnType<typeof mockFetch>) {
  return spy.mock.calls
    .filter(([, init]) => init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init?.body)))
}

beforeEach(() => {
  vi.clearAllMocks()
  catalogState.available = true
})

describe('<DocumentEditor />', () => {
  it('autosaves the canvas against the version it opened', async () => {
    const spy = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'salvar agora' }))
    await waitFor(() => expect(puts(spy)).toHaveLength(1))
    expect(puts(spy)[0]).toMatchObject({
      baseUpdatedAt: '2026-11-10T13:00:00.000Z',
      content: { catalog: 'document' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'salvar agora' }))
    await waitFor(() => expect(puts(spy)).toHaveLength(2))
    expect(puts(spy)[1].baseUpdatedAt).toBe('2026-11-10T14:00:00.000Z')
  })

  it('asks what to do when another save won', async () => {
    const spy = setup(409)
    fireEvent.click(await screen.findByRole('button', { name: 'salvar agora' }))
    expect(
      await screen.findByText('O documento mudou em outro lugar'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manter a minha' }))
    await waitFor(() => expect(puts(spy)).toHaveLength(2))
    expect(puts(spy)[1].baseUpdatedAt).toBeUndefined()
  })

  it('saves settings, kind and title through the row', async () => {
    const spy = setup()
    const settings = await screen.findByTestId('document-settings')
    // First toggle of "Leitura": Mostrar sumário.
    fireEvent.click(within(settings).getAllByRole('switch')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Folhas' }))
    const title = screen.getByTestId('document-editor-title')
    fireEvent.change(title, { target: { value: 'Proposta revisada' } })
    fireEvent.blur(title)
    await waitFor(
      () => expect(fetchBody(spy, `${BASE}/doc_1`, 'PATCH')).toBeTruthy(),
      { timeout: 3000 },
    )
    expect(fetchBody(spy, `${BASE}/doc_1`, 'PATCH')).toMatchObject({
      title: 'Proposta revisada',
      settings: { showToc: true, layout: 'paged' },
    })
    // The paged layout shows the sheet in the canvas.
    const width = Number(screen.getByTestId('viewport').textContent)
    expect(width).toBeLessThan(1024)
  })

  it('opens the preview and the send dialog from the top bar', async () => {
    setup()
    fireEvent.click(await screen.findByTestId('document-preview-open'))
    expect(
      await screen.findByText('Pré-visualização com dados de exemplo'),
    ).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })
    fireEvent.click(screen.getByTestId('document-send-open'))
    expect(
      await screen.findByRole('heading', { name: 'Atualizar versão' }),
    ).toBeTruthy()
  })

  it('waits for the catalog instead of crashing', async () => {
    catalogState.available = false
    setup()
    expect(
      await screen.findByText(/O editor de documentos ainda está sendo/),
    ).toBeTruthy()
  })
})
