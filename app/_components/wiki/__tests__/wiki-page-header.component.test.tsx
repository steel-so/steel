import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { Value } from 'platejs'
import { createPlateEditor, Plate } from 'platejs/react'
import { describe, expect, it, vi } from 'vitest'
import { AlignKit } from '@/components/editor/plugins/align-kit'
import { BasicNodesKit } from '@/components/editor/plugins/basic-nodes-kit'
import { CodeBlockKit } from '@/components/editor/plugins/code-block-kit'
import { FontKit } from '@/components/editor/plugins/font-kit'
import { ListKit } from '@/components/editor/plugins/list-kit'
import { MarkdownKit } from '@/components/editor/plugins/markdown-kit'
import { MediaKit } from '@/components/editor/plugins/media-kit'
import { TableKit } from '@/components/editor/plugins/table-kit'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import { WikiPageHeader } from '../wiki-page-header'
import { WikiToolbar } from '../wiki-toolbar'

// frimousse loads its emoji data over the network; a one-emoji stub keeps
// the picker about selection.
vi.mock('@/components/ui/emoji-picker', () => ({
  EmojiPicker: ({
    children,
    onEmojiSelect,
  }: {
    children: React.ReactNode
    onEmojiSelect: (emoji: { emoji: string }) => void
  }) => (
    <div>
      <button type='button' onClick={() => onEmojiSelect({ emoji: '🚀' })}>
        Emoji foguete
      </button>
      {children}
    </div>
  ),
  EmojiPickerSearch: () => null,
  EmojiPickerContent: () => null,
  EmojiPickerFooter: () => null,
}))
vi.mock('../wiki-page-labels', () => ({
  WikiPageLabels: ({ readOnly }: { readOnly?: boolean }) => (
    <p>Etiquetas {readOnly ? 'somente leitura' : 'editáveis'}</p>
  ),
}))

function renderHeader(
  props: Partial<React.ComponentProps<typeof WikiPageHeader>> = {},
) {
  const handlers = {
    onTitleChange: vi.fn(),
    onTitleCommit: vi.fn(),
    onIconChange: vi.fn(),
  }
  const utils = renderWithProviders(
    <WikiPageHeader
      workspaceId='ws-1'
      workspaceSlug='acme'
      wikiPageId='page-1'
      icon={null}
      title='Manual'
      labelIds={[]}
      readOnly={false}
      columnClassName='px-5'
      {...handlers}
      {...props}
    />,
  )
  return { ...utils, ...handlers }
}

describe('<WikiPageHeader />', () => {
  it('stacks icon, title and labels on the same text column', () => {
    const { container } = renderHeader({ icon: '📘' })

    const header = container.querySelector('header') as HTMLElement
    expect(header.className).toContain('px-5')
    const order = Array.from(header.children).map(
      (child) => child.getAttribute('aria-label') ?? child.textContent,
    )
    expect(order).toEqual([
      'Trocar ícone',
      'Título da página',
      'Etiquetas editáveis',
    ])
  })

  it('offers "Adicionar ícone" without reserving a line for it', () => {
    renderHeader()

    const add = screen.getByRole('button', { name: 'Adicionar ícone' })
    expect(add.parentElement?.className).toContain('absolute')
    expect(screen.queryByRole('button', { name: 'Trocar ícone' })).toBeNull()
  })

  it('removes the icon from the picker', async () => {
    const { user, onIconChange } = renderHeader({ icon: '📘' })

    await user.click(screen.getByRole('button', { name: 'Trocar ícone' }))
    await user.click(
      await screen.findByRole('button', { name: 'Remover ícone' }),
    )
    expect(onIconChange).toHaveBeenCalledWith(null)
  })

  it('edits the title and commits it on blur', async () => {
    const { user, onTitleChange, onTitleCommit } = renderHeader()

    const input = screen.getByRole('textbox', { name: 'Título da página' })
    await user.type(input, 'X')
    expect(onTitleChange).toHaveBeenLastCalledWith('ManualX')
    fireEvent.blur(input)
    expect(onTitleCommit).toHaveBeenCalled()
  })

  it('jumps to the text on Enter', async () => {
    const editable = document.createElement('div')
    editable.setAttribute('data-slate-editor', 'true')
    editable.tabIndex = 0
    document.body.append(editable)
    const { user } = renderHeader()

    await user.type(
      screen.getByRole('textbox', { name: 'Título da página' }),
      '{Enter}',
    )
    expect(document.activeElement).toBe(editable)
    editable.remove()
  })

  it('locks icon, title and labels while read-only', () => {
    renderHeader({ icon: '📘', readOnly: true })

    expect(screen.queryByRole('button', { name: 'Trocar ícone' })).toBeNull()
    expect(screen.getByRole('img', { name: 'Ícone da página' })).toBeTruthy()
    expect(
      screen
        .getByRole('textbox', { name: 'Título da página' })
        .hasAttribute('readonly'),
    ).toBe(true)
    expect(screen.getByText('Etiquetas somente leitura')).toBeTruthy()
  })

  it('shows no icon control at all for a read-only page without icon', () => {
    renderHeader({ readOnly: true })
    expect(screen.queryByRole('button', { name: 'Adicionar ícone' })).toBeNull()
  })
})

const VALUE: Value = [
  { type: 'h1', id: 'b-1', children: [{ text: 'Manual' }] },
  { type: 'p', id: 'b-2', children: [{ text: 'Texto da página' }] },
]

function renderToolbar(readOnly = false) {
  const editor = createPlateEditor({
    plugins: [
      ...BasicNodesKit,
      ...ListKit,
      ...CodeBlockKit,
      ...TableKit,
      ...MediaKit,
      ...AlignKit,
      ...FontKit,
      ...MarkdownKit,
    ],
    value: structuredClone(VALUE),
  })
  const onTogglePanel = vi.fn()
  const summarize = vi.fn(async (_markdown: string) => 'Um resumo')
  const utils = renderWithProviders(
    <Plate editor={editor}>
      <WikiToolbar
        readOnly={readOnly}
        panelOpen={false}
        onTogglePanel={onTogglePanel}
        summarize={summarize}
      />
    </Plate>,
  )
  return { ...utils, editor, onTogglePanel, summarize }
}

describe('<WikiToolbar />', () => {
  it('has the formatting groups and the panel toggle', async () => {
    const { user, onTogglePanel } = renderToolbar()

    for (const name of [
      'Alinhar à esquerda',
      'Centralizar',
      'Alinhar à direita',
      'Citação',
      'Bloco de código',
    ]) {
      // Pressable toolbar buttons are single-choice toggle items.
      expect(screen.getByRole('radio', { name })).toBeTruthy()
    }
    await user.click(
      screen.getByRole('button', { name: 'Abrir painel lateral' }),
    )
    expect(onTogglePanel).toHaveBeenCalled()
  })

  it('summarizes the page markdown and inserts the summary at the top', async () => {
    const { user, editor, summarize } = renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Resumo com IA' }))
    expect(summarize.mock.calls[0]?.[0]).toContain('# Manual')
    await user.click(
      await screen.findByRole('button', { name: 'Inserir no topo' }),
    )
    await waitFor(() =>
      expect(editor.children[0]).toMatchObject({
        type: 'p',
        children: [{ text: 'Um resumo' }],
      }),
    )
  })

  it('turns the selected block into a quote', async () => {
    const { user, editor } = renderToolbar()
    editor.tf.select({ path: [1, 0], offset: 0 })

    await user.click(screen.getByRole('radio', { name: 'Citação' }))
    await waitFor(() =>
      expect(editor.children[1]).toMatchObject({ type: 'blockquote' }),
    )
  })

  it('keeps only the summary and the panel toggle while read-only', () => {
    renderToolbar(true)

    expect(screen.queryByRole('radio', { name: 'Citação' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resumo com IA' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Abrir painel lateral' }),
    ).toBeTruthy()
  })
})
