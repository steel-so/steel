import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  DEMO_TOKENS,
  demoCatalog,
  demoDocument,
  demoPresets,
} from '../__demo__/demo-catalog'
import { CanvasEditor } from '../canvas-editor'
import type { CanvasEditorProps } from '../types'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
// TipTap needs layout APIs jsdom lacks; a textarea stands in for it.
vi.mock('../inspector/controls/richtext', () => ({
  RichTextControl: (props: {
    id: string
    label: string
    value?: string
    onChange: (v: string) => void
  }) => (
    <textarea
      id={props.id}
      aria-label={props.label}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}))

let store: CanvasStore

function setup(overrides: Partial<CanvasEditorProps> = {}) {
  const onSave = vi.fn(async (_doc: CanvasDocument) => true)
  render(
    <CanvasEditor
      catalog={demoCatalog}
      initialDocument={demoDocument()}
      viewportWidths={{ base: 1200, tablet: 768, mobile: 375 }}
      presets={demoPresets}
      colorTokens={DEMO_TOKENS}
      darkPreview
      title='Página de teste'
      actions={(ctx) => {
        store = ctx.store
        return <span>ações</span>
      }}
      onSave={onSave}
      {...overrides}
    />,
  )
  return { onSave }
}

const doc = () => store.getState().doc
const node = (id: string) => getNode(doc(), id)
const editor = () => screen.getByTestId('canvas-editor')
const inspector = () => screen.getByTestId('canvas-inspector')

function key(keyName: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: keyName, bubbles: true, ...init }),
    )
  })
}

function openTab(name: string) {
  fireEvent.click(within(editor()).getByRole('tab', { name }))
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('CanvasEditor', () => {
  it('renders the shell with the document settings', () => {
    setup()
    expect(within(editor()).getByText('Página de teste')).toBeTruthy()
    expect(within(editor()).getByText('ações')).toBeTruthy()
    expect(within(inspector()).getByText('Documento')).toBeTruthy()
    expect(within(inspector()).getByText('Cor de fundo')).toBeTruthy()
    expect(screen.getByTestId('palette-item-demo.heading')).toBeTruthy()
    expect(screen.getByText('Use uma tela maior para editar')).toBeTruthy()
  })

  it('renders the catalog components inside the iframe', async () => {
    setup()
    const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
    await waitFor(() =>
      expect(
        frame.contentDocument?.querySelector('[data-canvas-id="hero-title"]')
          ?.textContent,
      ).toBe('Internet de verdade para a sua empresa'),
    )
  })

  it('renders the canvas in standards mode with a doctype (no quirks)', async () => {
    setup()
    const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
    await waitFor(() =>
      expect(frame.contentDocument?.getElementById('canvas-root')).toBeTruthy(),
    )
    const frameDoc = frame.contentDocument as Document
    expect(frameDoc.compatMode).toBe('CSS1Compat')
    expect(frameDoc.doctype?.name).toBe('html')
    expect(frameDoc.documentElement.lang).toBe('pt-BR')
    // One root, at least as tall as the stage; no quirks-mode stretching.
    expect(frameDoc.querySelectorAll('#canvas-root')).toHaveLength(1)
    const root = frameDoc.getElementById('canvas-root') as HTMLElement
    expect(root.style.minHeight).toMatch(/^\d+px$/)
    const base = frameDoc.querySelector('style[data-canvas-base]')?.textContent
    expect(base).toContain('#canvas-root>:only-child{flex:1 0 auto}')
    expect(base).not.toContain('min-height:100%')
  })

  it('inserts a palette item at the selection on click', () => {
    setup()
    act(() => store.select('hero-text'))
    fireEvent.click(screen.getByTestId('palette-item-demo.button'))
    const left = node('hero-left')?.children ?? []
    expect(left).toHaveLength(4)
    const inserted = node(left[2])
    expect(inserted?.type).toBe('demo.button')
    expect(store.getState().selection).toEqual([left[2]])
    expect(
      within(inspector()).getByText('Botão', { selector: 'p' }),
    ).toBeTruthy()
  })

  it('filters the palette by search without accents', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Buscar componentes'), {
      target: { value: 'botao' },
    })
    expect(screen.getByTestId('palette-item-demo.button')).toBeTruthy()
    expect(screen.queryByTestId('palette-item-demo.image')).toBeNull()
    fireEvent.change(screen.getByLabelText('Buscar componentes'), {
      target: { value: 'xyz' },
    })
    expect(screen.getByText(/Nenhum componente encontrado/)).toBeTruthy()
  })

  it('edits props from the generated inspector', () => {
    setup()
    act(() => store.select('hero-title'))
    const field = within(inspector()).getByLabelText('Texto')
    fireEvent.change(field, { target: { value: 'Novo título' } })
    expect(node('hero-title')?.props.text).toBe('Novo título')
    fireEvent.click(within(inspector()).getByRole('button', { name: 'H3' }))
    expect(node('hero-title')?.props.level).toBe('h3')
    fireEvent.click(within(inspector()).getByRole('tab', { name: 'Estilo' }))
    expect(
      within(inspector()).getByText('Tipografia', { selector: 'button' }),
    ).toBeTruthy()
  })

  it('edits a responsive field per breakpoint and clears the override', () => {
    setup()
    act(() => store.select('hero-title'))
    fireEvent.click(within(editor()).getByRole('button', { name: 'Tablet' }))
    expect(store.getState().breakpoint).toBe('tablet')
    expect(within(inspector()).getByText('Herdado')).toBeTruthy()
    fireEvent.click(
      within(inspector()).getByRole('button', { name: 'Direita' }),
    )
    expect(node('hero-title')?.props.align).toEqual({
      base: 'left',
      mobile: 'center',
      tablet: 'right',
    })
    fireEvent.click(
      within(inspector()).getByRole('button', { name: 'Limpar sobrescrita' }),
    )
    expect(node('hero-title')?.props.align).toEqual({
      base: 'left',
      mobile: 'center',
    })
  })

  it('selects, renames, hides and locks from the layers tree', () => {
    setup()
    openTab('Camadas')
    const row = screen.getByTestId('layer-hero-cta')
    fireEvent.click(row)
    expect(store.getState().selection).toEqual(['hero-cta'])
    fireEvent.doubleClick(row)
    const input = screen.getByLabelText('Nome da camada')
    fireEvent.change(input, { target: { value: 'CTA principal' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(node('hero-cta')?.meta?.name).toBe('CTA principal')
    fireEvent.click(
      screen.getByRole('button', { name: 'Ocultar CTA principal' }),
    )
    expect(node('hero-cta')?.meta?.hidden).toBe(true)
    fireEvent.click(
      screen.getByRole('button', { name: 'Travar CTA principal' }),
    )
    expect(node('hero-cta')?.meta?.locked).toBe(true)
  })

  it('runs the keyboard shortcuts', () => {
    setup()
    act(() => store.select('hero-text'))
    key('ArrowDown')
    expect(store.getState().selection).toEqual(['hero-cta'])
    key('ArrowUp')
    expect(store.getState().selection).toEqual(['hero-text'])
    key('d', { ctrlKey: true })
    expect(node('hero-left')?.children).toHaveLength(4)
    key('z', { ctrlKey: true })
    expect(node('hero-left')?.children).toHaveLength(3)
    key('z', { ctrlKey: true, shiftKey: true })
    expect(node('hero-left')?.children).toHaveLength(4)
    key('Delete')
    expect(node('hero-left')?.children).toHaveLength(3)
    act(() => store.select('hero-title'))
    key('c', { ctrlKey: true })
    key('v', { ctrlKey: true })
    expect(node('hero-left')?.children).toHaveLength(4)
    act(() => store.select('hero-title'))
    key('ArrowDown', { altKey: true })
    expect(node('hero-left')?.children?.[1]).toBe('hero-title')
    key('Escape')
    expect(store.getState().selection).toEqual(['hero-left'])
    key('ArrowRight')
    expect(store.getState().selection).toEqual([
      node('hero-left')?.children?.[0],
    ])
    key('ArrowLeft')
    expect(store.getState().selection).toEqual(['hero-left'])
    key('=', { ctrlKey: true })
    expect(store.getState().zoom).toBeGreaterThan(0)
  })

  it('ignores shortcuts while typing in a field', () => {
    setup()
    act(() => store.select('hero-title'))
    const field = within(inspector()).getByLabelText('Texto')
    field.focus()
    fireEvent.keyDown(field, { key: 'Delete' })
    expect(node('hero-title')).toBeDefined()
  })

  it('toasts refused operations in pt-BR', () => {
    setup()
    act(() => {
      store.dispatch({ kind: 'remove', id: 'root' })
    })
    expect(notify.error).toHaveBeenCalledWith(
      'O elemento principal do documento não pode ser movido nem excluído.',
    )
  })

  it('warns when an undo skips a field someone else changed', () => {
    setup()
    act(() => {
      store.dispatch({ kind: 'update', id: 'hero-title', set: { text: 'A' } })
    })
    act(() => {
      const current = doc()
      const title = current.nodes['hero-title']
      store.applyRemote({
        ...current,
        nodes: {
          ...current.nodes,
          'hero-title': { ...title, props: { ...title.props, text: 'B' } },
        },
      })
    })
    act(() => store.undo())
    expect(notify.warning).toHaveBeenCalledWith(
      'Nada a desfazer neste passo: outra pessoa alterou os mesmos campos.',
    )
    expect(node('hero-title')?.props).toMatchObject({ text: 'B' })
  })

  it('autosaves after changes and saves on Ctrl+S', async () => {
    vi.useFakeTimers()
    const { onSave } = setup()
    act(() => {
      store.dispatch({ kind: 'update', id: 'hero-title', set: { text: 'A' } })
    })
    expect(screen.getByTestId('canvas-save-status').dataset.status).toBe(
      'dirty',
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('canvas-save-status').dataset.status).toBe(
      'saved',
    )
    act(() => {
      store.dispatch({ kind: 'update', id: 'hero-title', set: { text: 'B' } })
    })
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true }),
      )
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(store.getState().dirty).toBe(false)
  })

  it('shows the save error state', async () => {
    const onSave = vi.fn(async () => false)
    setup({ onSave })
    act(() => {
      store.dispatch({ kind: 'update', id: 'hero-title', set: { text: 'A' } })
    })
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', metaKey: true }),
      )
    })
    await waitFor(() =>
      expect(screen.getByTestId('canvas-save-status').dataset.status).toBe(
        'error',
      ),
    )
  })

  it('shows document settings, multi-selection and the selection overlay', () => {
    setup()
    act(() => store.select(['hero-title', 'hero-text']))
    expect(
      within(inspector()).getByText('2 elementos selecionados'),
    ).toBeTruthy()
    fireEvent.click(
      within(inspector()).getByRole('button', { name: 'Duplicar' }),
    )
    expect(node('hero-left')?.children).toHaveLength(5)
    act(() => store.select(null))
    expect(within(inspector()).getByText('Documento')).toBeTruthy()
  })

  it('toggles the dark preview and switches zoom', () => {
    setup()
    fireEvent.click(
      within(editor()).getByRole('button', { name: 'Ver no modo escuro' }),
    )
    const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
    expect(
      frame.contentDocument?.documentElement.hasAttribute('data-canvas-dark'),
    ).toBe(true)
    fireEvent.click(
      within(editor()).getByRole('button', { name: 'Ver no modo claro' }),
    )
    fireEvent.click(
      within(editor()).getByRole('button', { name: 'Aumentar zoom' }),
    )
    expect(store.getState().zoom).toBeGreaterThan(1)
    fireEvent.click(
      within(editor()).getByRole('button', { name: 'Diminuir zoom' }),
    )
    expect(store.getState().zoom).toBe(1)
  })

  it('inserts a preset from "Seções prontas"', () => {
    setup()
    openTab('Seções prontas')
    fireEvent.click(screen.getByTestId('preset-cta'))
    expect(node('root')?.children).toHaveLength(3)
    const inserted = node(node('root')?.children?.[2] as string)
    expect(inserted?.type).toBe('demo.section')
  })
})
