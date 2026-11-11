import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { type DocumentRuntime, DocumentView } from '@/src/lib/canvas-document'
import { DocumentRuntimeProvider } from '@/src/lib/canvas-document/runtime-context'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

function doc(children: CanvasNode[]): CanvasDocument {
  const nodes: Record<string, CanvasNode> = {
    root: { id: 'root', type: 'document', props: {}, children: ['s1'] },
    s1: {
      id: 's1',
      type: 'section',
      props: {},
      children: children.map((child) => child.id),
    },
  }
  for (const child of children) nodes[child.id] = child
  return { catalog: 'document', version: 1, rootId: 'root', nodes }
}

const PRICING: CanvasNode = {
  id: 'price',
  type: 'pricing-table',
  props: {
    items: [
      {
        id: 'base',
        name: 'Licenças',
        unitPrice: 100,
        quantity: 2,
        quantityEditable: true,
      },
      {
        id: 'opt',
        name: 'Treinamento',
        unitPrice: 50,
        quantity: 1,
        optional: true,
      },
    ],
  },
}

const CONTENT = doc([
  { id: 'cpf', type: 'field-cpf', props: { label: 'CPF', required: true } },
  PRICING,
  { id: 'acc', type: 'accept', props: { allowDecline: true } },
  { id: 'val', type: 'validity', props: { label: 'Válido até' } },
  { id: 'vid', type: 'video', props: { url: 'https://youtu.be/aqz-KE-bpKQ' } },
])

function runtime(overrides: Partial<DocumentRuntime> = {}): DocumentRuntime {
  return {
    versionId: 'v1',
    status: 'open',
    canAccept: true,
    canDownload: true,
    fieldValues: {},
    fieldErrors: {},
    selection: {},
    setFieldValue: vi.fn(),
    setSelection: vi.fn(),
    accept: vi.fn().mockResolvedValue({ ok: true }),
    decline: vi.fn().mockResolvedValue({ ok: true }),
    submitFields: vi.fn().mockResolvedValue({ ok: true }),
    downloadPdf: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

function renderView(value: DocumentRuntime | null, content = CONTENT) {
  const view = (
    <DocumentView
      content={content}
      theme={{}}
      context={{
        mode: 'public',
        settings: DEFAULT_DOCUMENT_SETTINGS,
        variables: {},
        validUntil: '2099-12-31T12:00:00.000Z',
      }}
    />
  )
  if (!value) return render(view)
  const wrapped = (
    <DocumentRuntimeProvider runtime={value}>{view}</DocumentRuntimeProvider>
  )
  return render(wrapped)
}

describe('document elements on the public link', () => {
  it('accepts with name and e-mail after the agreement box', async () => {
    const value = runtime()
    renderView(value)
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar documento' }))
    const missingName = await screen.findByRole('alert')
    expect(missingName.textContent).toBe('Informe seu nome completo.')
    fireEvent.change(screen.getByLabelText(/Nome completo/), {
      target: { value: 'Ana Souza' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar documento' }))
    const missingAgree = await screen.findByRole('alert')
    expect(missingAgree.textContent).toMatch(/Confirme que leu/)
    fireEvent.click(screen.getByLabelText(/Li e concordo/))
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar documento' }))
    await vi.waitFor(() => expect(value.accept).toHaveBeenCalled())
    expect(value.accept).toHaveBeenCalledWith({
      name: 'Ana Souza',
      email: undefined,
    })
  })

  it('declines with a reason', async () => {
    const value = runtime()
    renderView(value)
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    fireEvent.change(screen.getByLabelText(/motivo/), {
      target: { value: 'Fora do orçamento' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa' }))
    await vi.waitFor(() => expect(value.decline).toHaveBeenCalled())
    expect(value.decline).toHaveBeenCalledWith({
      name: undefined,
      reason: 'Fora do orçamento',
    })
  })

  it('shows the error returned by the server', async () => {
    const failure = { ok: false, message: 'Versão antiga' }
    const value = runtime({ accept: vi.fn().mockResolvedValue(failure) })
    renderView(value)
    fireEvent.change(screen.getByLabelText(/Nome completo/), {
      target: { value: 'Ana Souza' },
    })
    fireEvent.click(screen.getByLabelText(/Li e concordo/))
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar documento' }))
    expect(await screen.findByText('Versão antiga')).toBeTruthy()
  })

  it('shows final states instead of the form', () => {
    const { unmount } = renderView(
      runtime({
        status: 'accepted',
        acceptedByName: 'Ana Souza',
        acceptedAt: '2026-11-11T15:00:00.000Z',
      }),
    )
    const accepted = screen.getByText(/Aceito por Ana Souza em 11\/11\/2026/)
    expect(accepted).toBeTruthy()
    unmount()
    renderView(runtime({ status: 'declined' }))
    expect(screen.getByText('Este documento foi recusado.')).toBeTruthy()
  })

  it('blocks readers who cannot accept and previews without runtime', () => {
    const { unmount } = renderView(runtime({ canAccept: false }))
    const button = screen.getByRole('button', { name: 'Aceitar documento' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    unmount()
    renderView(null)
    expect(screen.getByText(/Pré-visualização/)).toBeTruthy()
  })

  it('masks and validates CPF fields', () => {
    const value = runtime({ fieldValues: { cpf: '111.111.111-11' } })
    renderView(value)
    const input = screen.getByLabelText(/CPF/)
    fireEvent.change(input, { target: { value: '52998224725' } })
    expect(value.setFieldValue).toHaveBeenCalledWith('cpf', '529.982.247-25')
    fireEvent.blur(input)
    expect(screen.getByText('CPF inválido.')).toBeTruthy()
  })

  it('lets the reader adjust the pricing table', () => {
    const value = runtime()
    renderView(value)
    fireEvent.click(screen.getByLabelText('Treinamento'))
    expect(value.setSelection).toHaveBeenCalledWith('opt', {
      selected: true,
      quantity: 1,
    })
    fireEvent.change(screen.getByLabelText('Quantidade de Licenças'), {
      target: { value: '5' },
    })
    expect(value.setSelection).toHaveBeenCalledWith('base', {
      selected: true,
      quantity: 5,
    })
  })

  it('totals the reader selection', () => {
    renderView(
      runtime({
        selection: {
          base: { selected: true, quantity: 3 },
          opt: { selected: true, quantity: 1 },
        },
      }),
    )
    const label = screen.getByText('Total', { selector: 'dt' })
    const total = label.nextElementSibling
    expect(total?.textContent?.replace(/\s/g, ' ')).toBe('R$ 350,00')
  })

  it('shows the validity and loads the video on click', () => {
    renderView(runtime())
    expect(screen.getByText(/Válido até 31\/12\/2099/)).toBeTruthy()
    expect(document.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Assistir/ }))
    expect(document.querySelector('iframe')?.src).toContain('youtube.com')
  })
})
