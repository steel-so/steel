import '@/src/__tests__/helpers/dom-matchers'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { latestDocumentImport } from '@/src/hooks/use-document-imports'
import type { DocumentImportDTO } from '@/types/document'
import type { DocumentImportContextDTO } from '@/types/document-import'
import {
  DocumentImportDialog,
  fileProblem,
  formatFileSize,
  importModeOf,
} from '../document-import-dialog'

const push = vi.hoisted(() => vi.fn())
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/notify', () => ({ notify }))

const WS = 'ws1'
const BASE = `/api/workspaces/${WS}/crm/documents/imports`

function context(
  overrides: Partial<DocumentImportContextDTO> = {},
): DocumentImportContextDTO {
  return {
    available: true,
    unavailableReason: null,
    nativePdf: true,
    maxBytes: 20 * 1024 * 1024,
    maxPages: 60,
    quota: { usedUsd: 1, quotaUsd: 50, remainingUsd: 49, exceeded: false },
    estimate: {
      model: 'Claude Sonnet 5',
      baseUsd: 0.01,
      pageUsd: 0.013,
      promptUsd: 0.062,
    },
    ...overrides,
  }
}

function importDto(overrides: Partial<DocumentImportDTO> = {}) {
  return {
    id: 'imp1',
    mode: 'PDF',
    status: 'PENDING',
    kind: 'OTHER',
    fileName: 'proposta.pdf',
    progress: { step: 'queued', message: 'Na fila', pct: 0 },
    documentId: null,
    error: null,
    costUsd: null,
    createdAt: '2026-11-11T13:00:00.000Z',
    finishedAt: null,
    ...overrides,
  } satisfies DocumentImportDTO
}

const READY = importDto({
  status: 'READY',
  documentId: 'doc1',
  progress: { step: 'done', message: 'Pronto', pct: 100 },
})

function stream(frames: DocumentImportDTO[]): Response {
  const body = frames
    .map((dto) => `event: import\ndata: ${JSON.stringify(dto)}\n\n`)
    .join('')
  return new Response(`: connected\n\n${body}`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function quotaError(): Response {
  const body = {
    success: false,
    message: 'A cota mensal de IA acabou',
    error: { code: 'AI_QUOTA_EXCEEDED' },
  }
  return new Response(JSON.stringify(body), { status: 402 })
}

function setup(options: {
  ctx?: DocumentImportContextDTO
  created?: DocumentImportDTO
  frames?: DocumentImportDTO[]
  latest?: DocumentImportDTO
  initialMode?: 'PDF' | 'PROMPT'
  quotaError?: boolean
}) {
  const created = options.created ?? importDto()
  const frames = options.frames ?? [READY]
  const spy = mockFetch([
    { match: `${BASE}/imp1/stream`, handler: () => stream(frames) },
    { match: `${BASE}/context`, data: options.ctx ?? context() },
    { match: `${BASE}/imp1`, data: options.latest ?? frames.at(-1) },
    {
      method: 'POST',
      match: BASE,
      handler: () => (options.quotaError ? quotaError() : created),
    },
  ])
  const onOpenChange = vi.fn()
  renderWithQuery(
    <DocumentImportDialog
      workspaceId={WS}
      workspaceSlug='acme'
      open
      onOpenChange={onOpenChange}
      initialMode={options.initialMode}
    />,
  )
  return { spy, onOpenChange }
}

function pickFile(file: File) {
  fireEvent.change(screen.getByTestId('document-import-input'), {
    target: { files: [file] },
  })
}

const submitButton = () =>
  screen.getByTestId('document-import-submit') as HTMLButtonElement

const pdfFile = (size = 600_000) =>
  new File([new Uint8Array(size)], 'proposta.pdf', { type: 'application/pdf' })

beforeEach(() => {
  push.mockReset()
})

describe('DocumentImportDialog', () => {
  it('should upload a PDF, follow the build and open the editor', async () => {
    const { spy, onOpenChange } = setup({
      frames: [
        importDto({
          status: 'RUNNING',
          progress: { step: 'sections', message: 'Montando', pct: 60 },
        }),
        READY,
      ],
    })

    expect(await screen.findByTestId('site-ai-cost')).toBeInTheDocument()
    pickFile(pdfFile())
    expect(screen.getByTestId('document-import-file')).toHaveTextContent(
      'proposta.pdf',
    )
    expect(screen.getByTestId('site-ai-cost').textContent).toMatch(/0,14/)

    fireEvent.click(screen.getByTestId('document-import-submit'))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/crm/documents/doc1/edit'),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(notify.success).toHaveBeenCalled()
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST')
    const form = post?.[1]?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('mode')).toBe('PDF')
    expect(form.get('kind')).toBe('OTHER')
    expect((form.get('file') as File).name).toBe('proposta.pdf')
  })

  it('should take a dropped DOCX and remove it', async () => {
    setup({})
    await screen.findByTestId('site-ai-cost')

    const docx = new File(['PK'], 'contrato.docx', { type: '' })
    fireEvent.dragOver(screen.getByTestId('document-import-drop'))
    expect(screen.getByTestId('document-import-drop')).toHaveAttribute(
      'data-dragging',
      'true',
    )
    fireEvent.drop(screen.getByTestId('document-import-drop'), {
      dataTransfer: { files: [docx] },
    })

    expect(screen.getByTestId('document-import-file')).toHaveTextContent(
      'contrato.docx',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover arquivo' }))
    expect(screen.getByTestId('document-import-drop')).toBeInTheDocument()
  })

  it('should refuse a file that is not PDF or DOCX', async () => {
    setup({})
    await screen.findByTestId('site-ai-cost')

    pickFile(new File(['x'], 'notas.txt', { type: 'text/plain' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Envie um arquivo PDF ou DOCX.',
    )
    expect(submitButton().disabled).toBe(true)
  })

  it('should generate from a prompt', async () => {
    const created = importDto({ mode: 'PROMPT', fileName: null })
    const { spy } = setup({
      initialMode: 'PROMPT',
      created,
      frames: [{ ...READY, mode: 'PROMPT' }],
    })
    await screen.findByTestId('site-ai-cost')
    expect(screen.getByTestId('site-ai-cost').textContent).toMatch(/0,06/)
    expect(submitButton().disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('O que a IA deve escrever?'), {
      target: { value: '  Proposta de PABX para clínica  ' },
    })
    fireEvent.change(screen.getByLabelText('Título (opcional)'), {
      target: { value: 'Proposta Clínica' },
    })
    fireEvent.click(screen.getByTestId('document-import-submit'))

    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(fetchBody(spy, BASE)).toEqual({
      mode: 'PROMPT',
      prompt: 'Proposta de PABX para clínica',
      kind: 'PROPOSAL',
      title: 'Proposta Clínica',
    })
  })

  it('should show the failure and go back to the form', async () => {
    const failed = importDto({
      status: 'FAILED',
      error: 'A IA recusou o conteúdo deste arquivo.',
      progress: { step: 'failed', message: 'x', pct: 100 },
    })
    setup({ frames: [failed] })
    await screen.findByTestId('site-ai-cost')
    pickFile(pdfFile())
    fireEvent.click(screen.getByTestId('document-import-submit'))

    expect(
      await screen.findByText('A IA recusou o conteúdo deste arquivo.'),
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(screen.getByTestId('document-import-submit')).toBeInTheDocument()
  })

  it('should show the live steps while the build runs', async () => {
    const running = importDto({
      status: 'RUNNING',
      progress: { step: 'structure', message: 'Entendendo', pct: 30 },
    })
    setup({ frames: [running], latest: running })
    await screen.findByTestId('site-ai-cost')
    pickFile(pdfFile())
    fireEvent.click(screen.getByTestId('document-import-submit'))

    const progress = await screen.findByTestId('document-import-progress')
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      ),
    )
    const steps = progress.querySelectorAll('li')
    expect([...steps].map((step) => step.dataset.status)).toEqual([
      'done',
      'running',
      'pending',
      'pending',
    ])
    expect(progress).toHaveTextContent('Entendendo a estrutura')
  })

  it('should tell where the document goes when closed mid-build', async () => {
    const running = importDto({
      status: 'RUNNING',
      progress: { step: 'structure', message: 'Entendendo', pct: 30 },
    })
    const { onOpenChange } = setup({ frames: [running], latest: running })
    await screen.findByTestId('site-ai-cost')
    pickFile(pdfFile())
    fireEvent.click(screen.getByTestId('document-import-submit'))
    await screen.findByTestId('document-import-progress')
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '30',
      ),
    )

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(notify.info).toHaveBeenCalledWith(
      expect.stringContaining('continua montando'),
    )
  })

  it('should explain when the AI is unavailable', async () => {
    setup({
      ctx: context({
        available: false,
        unavailableReason: 'A IA do CRM não está incluída no plano.',
      }),
    })

    expect(
      await screen.findByText('A IA do CRM não está incluída no plano.'),
    ).toBeInTheDocument()
    pickFile(pdfFile())
    expect(submitButton().disabled).toBe(true)
  })

  it('should warn when the model reads only the text', async () => {
    setup({ ctx: context({ nativePdf: false }) })

    expect(await screen.findByText(/lê só o texto do PDF/)).toBeInTheDocument()
  })

  it('should report an API error and stay on the form', async () => {
    setup({ quotaError: true })
    await screen.findByTestId('site-ai-cost')
    pickFile(pdfFile())
    fireEvent.click(screen.getByTestId('document-import-submit'))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(screen.getByTestId('document-import-submit')).toBeInTheDocument()
  })
})

describe('document import helpers', () => {
  it('should tell the mode of a file', () => {
    const typed = new File([''], 'x', { type: 'application/pdf' })
    expect(importModeOf(new File([''], 'a.PDF'))).toBe('PDF')
    expect(importModeOf(typed)).toBe('PDF')
    expect(importModeOf(new File([''], 'b.docx'))).toBe('DOCX')
    expect(importModeOf(new File([''], 'c.doc'))).toBeNull()
  })

  it('should format sizes and explain problems', () => {
    expect(formatFileSize(10)).toBe('1 KB')
    expect(formatFileSize(830 * 1024)).toBe('830 KB')
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2,5 MB')
    const empty = new File([], 'a.pdf')
    const large = new File(['x'.repeat(200)], 'a.pdf')
    expect(fileProblem(empty, 100)).toBe('O arquivo está vazio.')
    expect(fileProblem(large, 100)).toMatch(/o limite é/)
    expect(fileProblem(new File(['x'], 'a.pdf'), 100)).toBeNull()
  })
})

describe('latestDocumentImport()', () => {
  const at = (pct: number) =>
    importDto({ status: 'RUNNING', progress: { step: 'sections', pct } })

  it('should keep the most advanced snapshot', () => {
    expect(latestDocumentImport(undefined, at(10)).progress.pct).toBe(10)
    expect(latestDocumentImport(at(60), at(30)).progress.pct).toBe(60)
    expect(latestDocumentImport(at(30), at(60)).progress.pct).toBe(60)
    expect(latestDocumentImport(READY, at(90)).status).toBe('READY')
    expect(latestDocumentImport(at(90), READY).status).toBe('READY')
    const other = { ...at(5), id: 'imp2' }
    expect(latestDocumentImport(at(90), other).id).toBe('imp2')
  })
})
