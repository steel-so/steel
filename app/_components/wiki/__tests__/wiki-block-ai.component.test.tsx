import { screen, waitFor, within } from '@testing-library/react'
import type { TElement, Value } from 'platejs'
import { createPlateEditor, Plate } from 'platejs/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownKit } from '@/components/editor/plugins/markdown-kit'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import { ApiError } from '@/src/hooks/_fetch'
import type { WikiAiAction } from '@/types/wiki-page'
import { WikiAiSummaryButton } from '../wiki-ai-summary'
import {
  WikiAiMenu,
  type WikiAiMenuProps,
  WikiBlockAiContext,
  WikiBlockAiSlot,
  wikiAiErrorMessage,
} from '../wiki-block-ai'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

function renderMenu(props: Partial<WikiAiMenuProps> = {}) {
  const handlers = {
    getText: vi.fn(() => 'Texto do bloco'),
    run: vi.fn(async (_action: WikiAiAction, _text: string) => 'Resultado'),
    onReplace: vi.fn(),
    onInsertBelow: vi.fn(),
    onUseAsTitle: vi.fn(),
    ...props,
  }
  const utils = renderWithProviders(<WikiAiMenu {...handlers} />)
  return { ...utils, ...handlers }
}

async function pick(
  user: ReturnType<typeof renderMenu>['user'],
  label: string,
) {
  await user.click(screen.getByRole('button', { name: 'IA neste bloco' }))
  await user.click(await screen.findByRole('button', { name: label }))
}

describe('<WikiAiMenu />', () => {
  it('offers the five actions', async () => {
    const { user } = renderMenu()

    await user.click(screen.getByRole('button', { name: 'IA neste bloco' }))
    const list = await screen.findByRole('list', { name: 'Ações de IA' })
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Parafrasear',
      'Simplificar',
      'Elaborar',
      'Resumir',
      'Obter título',
    ])
  })

  it('previews the result and replaces the block', async () => {
    const { user, run, onReplace } = renderMenu()

    await pick(user, 'Simplificar')

    expect(run).toHaveBeenCalledWith('simplify', 'Texto do bloco')
    expect((await screen.findByTestId('wiki-ai-preview')).textContent).toBe(
      'Resultado',
    )
    await user.click(screen.getByRole('button', { name: 'Substituir' }))
    expect(onReplace).toHaveBeenCalledWith('Resultado')
    expect(screen.queryByTestId('wiki-ai-preview')).toBeNull()
  })

  it('inserts the result below', async () => {
    const { user, onInsertBelow } = renderMenu()

    await pick(user, 'Elaborar')
    await user.click(
      await screen.findByRole('button', { name: 'Inserir abaixo' }),
    )
    expect(onInsertBelow).toHaveBeenCalledWith('Resultado')
  })

  it('discards the result', async () => {
    const { user, onReplace, onInsertBelow } = renderMenu()

    await pick(user, 'Parafrasear')
    await user.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(onReplace).not.toHaveBeenCalled()
    expect(onInsertBelow).not.toHaveBeenCalled()
  })

  it('uses a generated title as the page title', async () => {
    const { user, onUseAsTitle } = renderMenu({
      run: vi.fn(async () => '  Novo título  '),
    })

    await pick(user, 'Obter título')
    expect(screen.queryByRole('button', { name: 'Substituir' })).toBeNull()
    await user.click(
      await screen.findByRole('button', { name: 'Usar como título da página' }),
    )
    expect(onUseAsTitle).toHaveBeenCalledWith('Novo título')
  })

  it('shows a loading state while the AI works', async () => {
    let resolve: (text: string) => void = () => {}
    const { user } = renderMenu({
      run: vi.fn(
        () =>
          new Promise<string>((done) => {
            resolve = done
          }),
      ),
    })

    await pick(user, 'Resumir')
    expect(screen.getByText('Gerando com IA…')).toBeTruthy()
    resolve('Pronto')
    expect((await screen.findByTestId('wiki-ai-preview')).textContent).toBe(
      'Pronto',
    )
  })

  it('explains a used-up quota and goes back to the actions', async () => {
    const { user } = renderMenu({
      run: vi.fn(async () => {
        throw new ApiError('quota', 'AI_QUOTA_EXCEEDED', 402)
      }),
    })

    await pick(user, 'Resumir')
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A cota mensal de IA do workspace acabou',
    )
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('list', { name: 'Ações de IA' })).toBeTruthy()
  })

  it('does not call the AI on an empty block', async () => {
    const { user, run } = renderMenu({ getText: () => '   ' })

    await pick(user, 'Resumir')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Este bloco não tem texto para a IA trabalhar.',
    )
    expect(run).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('wikiAiErrorMessage', () => {
  it('maps AI availability codes to one pt-BR message', () => {
    for (const code of [
      'AI_MODEL_NOT_ENABLED',
      'AI_PROVIDER_UNAVAILABLE',
      'CRM_AI_NOT_CONFIGURED',
    ]) {
      expect(wikiAiErrorMessage(new ApiError('x', code, 503))).toBe(
        'A IA não está disponível neste workspace. Confira em Ajustes › IA.',
      )
    }
  })

  it('keeps the server message, then a generic fallback', () => {
    expect(wikiAiErrorMessage(new Error('Texto longo demais'))).toBe(
      'Texto longo demais',
    )
    expect(wikiAiErrorMessage('boom')).toBe(
      'Não foi possível gerar o texto com IA.',
    )
  })
})

const VALUE: Value = [
  { type: 'h2', id: 'b-1', children: [{ text: 'Título antigo' }] },
  { type: 'p', id: 'b-2', children: [{ text: 'Segundo bloco' }] },
]

function renderSlot(result: string) {
  const editor = createPlateEditor({
    plugins: MarkdownKit,
    value: structuredClone(VALUE),
  })
  const run = vi.fn(async () => result)
  const onUseAsTitle = vi.fn()
  const element = editor.children[0] as TElement
  const utils = renderWithProviders(
    <Plate editor={editor}>
      <WikiBlockAiContext.Provider value={{ run, onUseAsTitle }}>
        <WikiBlockAiSlot element={element} top={0} />
      </WikiBlockAiContext.Provider>
    </Plate>,
  )
  return { ...utils, editor, run }
}

describe('<WikiBlockAiSlot />', () => {
  it('sends the block text and keeps a heading a heading on replace', async () => {
    const { user, editor, run } = renderSlot('Título novo')

    await pick(user, 'Parafrasear')
    expect(run).toHaveBeenCalledWith('paraphrase', 'Título antigo')
    await user.click(await screen.findByRole('button', { name: 'Substituir' }))

    await waitFor(() =>
      expect(editor.children[0]).toMatchObject({
        type: 'h2',
        children: [{ text: 'Título novo' }],
      }),
    )
    expect(editor.children).toHaveLength(2)
  })

  it('replaces the block with several blocks when the AI returns them', async () => {
    const { user, editor } = renderSlot('Primeiro\n\n- item')

    await pick(user, 'Elaborar')
    await user.click(await screen.findByRole('button', { name: 'Substituir' }))

    await waitFor(() => expect(editor.children.length).toBeGreaterThan(2))
    expect(editor.children[0]).toMatchObject({
      type: 'p',
      children: [{ text: 'Primeiro' }],
    })
  })

  it('inserts the result right below the block', async () => {
    const { user, editor } = renderSlot('Complemento')

    await pick(user, 'Elaborar')
    await user.click(
      await screen.findByRole('button', { name: 'Inserir abaixo' }),
    )

    await waitFor(() => expect(editor.children).toHaveLength(3))
    expect(editor.children[1]).toMatchObject({
      type: 'p',
      children: [{ text: 'Complemento' }],
    })
  })

  it('renders nothing outside the wiki (no context)', () => {
    const editor = createPlateEditor({ plugins: MarkdownKit, value: VALUE })
    renderWithProviders(
      <Plate editor={editor}>
        <WikiBlockAiSlot element={editor.children[0] as TElement} top={0} />
      </Plate>,
    )
    expect(screen.queryByRole('button', { name: 'IA neste bloco' })).toBeNull()
  })
})

describe('<WikiAiSummaryButton />', () => {
  function renderSummary(
    summarize = vi.fn(async (_markdown: string) => 'Resumo da página'),
    markdown = '# Manual\n\nTexto',
  ) {
    const onInsertAtTop = vi.fn()
    const utils = renderWithProviders(
      <WikiAiSummaryButton
        getMarkdown={() => markdown}
        summarize={summarize}
        onInsertAtTop={onInsertAtTop}
      />,
    )
    return { ...utils, summarize, onInsertAtTop }
  }

  it('summarizes the page markdown and inserts it at the top', async () => {
    const { user, summarize, onInsertAtTop } = renderSummary()

    await user.click(screen.getByRole('button', { name: 'Resumo com IA' }))
    expect(summarize).toHaveBeenCalledWith('# Manual\n\nTexto')
    expect((await screen.findByTestId('wiki-ai-summary')).textContent).toBe(
      'Resumo da página',
    )
    await user.click(screen.getByRole('button', { name: 'Inserir no topo' }))
    expect(onInsertAtTop).toHaveBeenCalledWith('Resumo da página')
  })

  it('copies the summary', async () => {
    const { user } = renderSummary()

    await user.click(screen.getByRole('button', { name: 'Resumo com IA' }))
    await user.click(await screen.findByRole('button', { name: 'Copiar' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Resumo copiado'),
    )
    expect(await navigator.clipboard.readText()).toBe('Resumo da página')
  })

  it('refuses an empty page and reports AI errors', async () => {
    const empty = renderSummary(undefined, '  ')
    await empty.user.click(
      screen.getByRole('button', { name: 'Resumo com IA' }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A página ainda não tem texto para resumir.',
    )
    expect(empty.summarize).not.toHaveBeenCalled()
    empty.unmount()

    const failing = renderSummary(
      vi.fn(async () => {
        throw new ApiError('quota', 'AI_QUOTA_EXCEEDED', 402)
      }),
    )
    await failing.user.click(
      screen.getByRole('button', { name: 'Resumo com IA' }),
    )
    expect((await screen.findByRole('alert')).textContent).toContain(
      'cota mensal',
    )
  })
})
