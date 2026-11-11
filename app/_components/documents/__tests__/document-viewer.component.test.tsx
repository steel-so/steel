import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import { useDocumentRuntime } from '@/src/lib/canvas-document/runtime-context'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import { DocumentViewer } from '../public/document-viewer'
import {
  downloadDocumentPdf,
  initialRuntimeStatus,
  validateDocumentFields,
} from '../public/public-runtime'
import { fakePublic } from './fixtures'

const tracker = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn() }))
vi.mock('@/src/lib/canvas-document/tracker', () => ({
  startDocumentTracker: (options: unknown) => {
    tracker.start(options)
    return tracker.stop
  },
}))

/** Stand-in for the catalog renderer: drives the runtime like the real
 * accept, field and pricing elements do. */
function FakeView() {
  const runtime = useDocumentRuntime()
  if (!runtime) return null
  return (
    <div>
      <section data-doc-section='s1' data-doc-section-name='Capa'>
        Capa
      </section>
      <section data-doc-section='s2' data-doc-section-name='Investimento'>
        <label>
          CNPJ
          <input
            value={String(runtime.fieldValues.f1 ?? '')}
            onChange={(event) =>
              runtime.setFieldValue('f1', event.target.value)
            }
          />
        </label>
        {runtime.fieldErrors.f1 ? <p>{runtime.fieldErrors.f1}</p> : null}
        <button
          type='button'
          onClick={() =>
            runtime.setSelection('i1', { selected: true, quantity: 3 })
          }
        >
          três licenças
        </button>
        {runtime.canAccept ? (
          <button
            type='button'
            onClick={async () => {
              const result = await runtime.accept({ name: 'Maria Souza' })
              if (!result.ok) {
                document.body.dataset.result = result.message
              }
            }}
          >
            aceitar
          </button>
        ) : null}
        <button
          type='button'
          onClick={() => void runtime.decline({ reason: 'Caro' })}
        >
          recusar
        </button>
        <span data-testid='status'>{runtime.status}</span>
      </section>
    </div>
  )
}

vi.mock('@/src/lib/canvas-document', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  DocumentView: () => <FakeView />,
  // The envelope is enough here; the catalog has its own tests.
  validateDocumentContent: (input: unknown) => ({ ok: true, value: input }),
}))

const URL_BASE = '/api/documents/tok_maria'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  delete document.body.dataset.result
})

afterEach(() => {
  vi.useRealTimers()
})

describe('initialRuntimeStatus', () => {
  const now = Date.parse('2026-11-11T12:00:00Z')
  it('starts open, decided or expired', () => {
    expect(initialRuntimeStatus(fakePublic(), now)).toBe('open')
    expect(
      initialRuntimeStatus(fakePublic({}, { status: 'ACCEPTED' }), now),
    ).toBe('accepted')
    expect(
      initialRuntimeStatus(fakePublic({}, { status: 'DECLINED' }), now),
    ).toBe('declined')
    expect(
      initialRuntimeStatus(fakePublic({}, { status: 'EXPIRED' }), now),
    ).toBe('expired')
    expect(
      initialRuntimeStatus(
        fakePublic({}, { validUntil: '2026-11-01T00:00:00Z' }),
        now,
      ),
    ).toBe('expired')
  })
})

describe('validateDocumentFields', () => {
  it('flags blank required fields and bad e-mails', () => {
    const fields = [
      { id: 'a', type: 'field-text' as const, label: 'Nome', required: true },
      { id: 'b', type: 'field-email' as const, label: 'E-mail' },
    ]
    expect(validateDocumentFields(fields, { b: 'x@' })).toEqual({
      a: 'Preencha este campo',
      b: 'E-mail inválido',
    })
    const valid = validateDocumentFields(fields, { a: 'Ana', b: 'a@b.co' })
    expect(valid).toEqual({})
  })
})

describe('<DocumentViewer />', () => {
  it('renders the document with the brand and starts the tracker', async () => {
    const { unmount } = render(<DocumentViewer data={fakePublic()} />)
    expect(await screen.findByText('Stratus Telecom')).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Proposta — Acme' }),
    ).toBeTruthy()
    await waitFor(() =>
      expect(tracker.start).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'tok_maria', versionId: 'v1' }),
      ),
    )
    unmount()
    expect(tracker.stop).toHaveBeenCalled()
  })

  it('checks required fields, then accepts with fields and selection', async () => {
    const spy = mockFetch([
      { method: 'POST', match: `${URL_BASE}/accept`, data: { ok: true } },
    ])
    render(<DocumentViewer data={fakePublic()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'aceitar' }))
    expect(await screen.findByText('Preencha este campo')).toBeTruthy()
    expect(fetchBody(spy, `${URL_BASE}/accept`)).toBeUndefined()

    fireEvent.change(screen.getByLabelText('CNPJ'), {
      target: { value: '11.222.333/0001-81' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'três licenças' }))
    fireEvent.click(screen.getByRole('button', { name: 'aceitar' }))
    expect(await screen.findByTestId('document-banner-accepted')).toBeTruthy()
    expect(screen.getByTestId('status').textContent).toBe('accepted')
    expect(fetchBody(spy, `${URL_BASE}/accept`)).toEqual({
      name: 'Maria Souza',
      agreed: true,
      fields: { f1: '11.222.333/0001-81' },
      selection: { i1: { selected: true, quantity: 3 } },
      versionId: 'v1',
    })
  })

  it('explains a stale version', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${URL_BASE}/accept`,
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Versão antiga',
              error: { code: 'DOCUMENT_VERSION_STALE' },
            }),
            { status: 409 },
          ),
      },
    ])
    render(<DocumentViewer data={fakePublic()} />)
    fireEvent.change(await screen.findByLabelText('CNPJ'), {
      target: { value: '11.222.333/0001-81' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'aceitar' }))
    await waitFor(() =>
      expect(document.body.dataset.result).toMatch(/foi atualizado/),
    )
    expect(screen.getByTestId('status').textContent).toBe('open')
  })

  it('declines', async () => {
    const spy = mockFetch([
      { method: 'POST', match: `${URL_BASE}/decline`, data: { ok: true } },
    ])
    render(<DocumentViewer data={fakePublic()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'recusar' }))
    expect(await screen.findByTestId('document-banner-declined')).toBeTruthy()
    expect(fetchBody(spy, `${URL_BASE}/decline`)).toEqual({
      reason: 'Caro',
      versionId: 'v1',
    })
  })

  it('shows the expired banner and hides accepting', async () => {
    render(
      <DocumentViewer
        data={fakePublic({}, { validUntil: '2020-01-31T23:59:59.000Z' })}
      />,
    )
    expect(await screen.findByTestId('document-banner-expired')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'aceitar' })).toBeNull()
  })

  it('asks who is reading on a generic link that requires it', async () => {
    const spy = mockFetch([
      { method: 'POST', match: `${URL_BASE}/identify`, data: { ok: true } },
    ])
    const data = fakePublic(
      { recipient: null },
      {
        settings: { ...DEFAULT_DOCUMENT_SETTINGS, requireIdentification: true },
      },
    )
    render(<DocumentViewer data={data} />)
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Carlos Pereira' },
    })
    fireEvent.change(screen.getByLabelText('E-mail'), {
      target: { value: 'carlos@acme.com.br' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir documento' }))
    expect(await screen.findByLabelText('CNPJ')).toBeTruthy()
    expect(fetchBody(spy, `${URL_BASE}/identify`)).toEqual({
      name: 'Carlos Pereira',
      email: 'carlos@acme.com.br',
    })
    expect(
      window.localStorage.getItem('steel.document.reader.tok_maria'),
    ).toContain('Carlos Pereira')
  })

  it('shows the table of contents when the document asks for it', async () => {
    const data = fakePublic(
      {},
      { settings: { ...DEFAULT_DOCUMENT_SETTINGS, showToc: true } },
    )
    render(<DocumentViewer data={data} />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Abrir o sumário' }),
    )
    expect(
      (await screen.findAllByRole('button', { name: 'Investimento' })).length,
    ).toBeGreaterThan(0)
  })
})

describe('downloadDocumentPdf', () => {
  it('waits while the PDF renders and saves the file', async () => {
    vi.useFakeTimers()
    let calls = 0
    const spy = vi.fn(async () => {
      calls += 1
      return calls === 1
        ? new Response(null, { status: 202 })
        : new Response('%PDF', {
            status: 200,
            headers: {
              'content-disposition': 'attachment; filename="proposta.pdf"',
            },
          })
    })
    vi.stubGlobal('fetch', spy)
    const createObjectURL = vi.fn(() => 'blob:pdf')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    const pending = downloadDocumentPdf('tok_maria', 'Proposta')
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toEqual({ ok: true })
    expect(spy).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('reports a failed export', async () => {
    mockFetch([
      { match: `${URL_BASE}/pdf`, status: 403, error: 'Download desativado' },
    ])
    const result = await downloadDocumentPdf('tok_maria', 'Proposta')
    expect(result).toEqual({ ok: false, message: 'Download desativado' })
  })
})
