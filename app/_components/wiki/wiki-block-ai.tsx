'use client'

import { Loading03Icon, SparklesIcon } from '@hugeicons-pro/core-stroke-rounded'
import { NodeApi, PathApi, type TElement } from 'platejs'
import { useEditorRef } from 'platejs/react'
import { createContext, useContext, useState } from 'react'
import type { BlockGutterSlot } from '@/components/editor/ui/block-draggable'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { isApiErrorCode } from '@/src/hooks/_fetch'
import type { WikiAiAction } from '@/types/wiki-page'
import { markdownToBlocks } from './wiki-markdown'

export const WIKI_BLOCK_AI_ACTIONS: { action: WikiAiAction; label: string }[] =
  [
    { action: 'paraphrase', label: 'Parafrasear' },
    { action: 'simplify', label: 'Simplificar' },
    { action: 'elaborate', label: 'Elaborar' },
    { action: 'summarize', label: 'Resumir' },
    { action: 'title', label: 'Obter título' },
  ]

/** pt-BR message for a failed AI call (quota, AI off, provider down…). */
export function wikiAiErrorMessage(error: unknown): string {
  if (isApiErrorCode(error, 'AI_QUOTA_EXCEEDED')) {
    return 'A cota mensal de IA do workspace acabou. Ela renova no próximo mês.'
  }
  if (
    isApiErrorCode(
      error,
      'AI_MODEL_NOT_ENABLED',
      'AI_PROVIDER_UNAVAILABLE',
      'CRM_AI_NOT_CONFIGURED',
      'WIKI_AI_DISABLED',
      'AI_DISABLED',
    )
  ) {
    return 'A IA não está disponível neste workspace. Confira em Ajustes › IA.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Não foi possível gerar o texto com IA.'
}

type MenuState =
  | { step: 'menu' }
  | { step: 'loading'; action: WikiAiAction }
  | { step: 'result'; action: WikiAiAction; text: string }
  | { step: 'error'; action: WikiAiAction; message: string }

export interface WikiAiMenuProps {
  /** Text the action runs on (read when the action is picked). */
  getText: () => string
  run: (action: WikiAiAction, text: string) => Promise<string>
  onReplace: (text: string) => void
  onInsertBelow: (text: string) => void
  onUseAsTitle: (text: string) => void
  disabled?: boolean
}

/**
 * The sparkles button beside a block's drag handle: pick an action, preview
 * the result, then replace the block, insert below or discard it.
 */
export function WikiAiMenu({
  getText,
  run,
  onReplace,
  onInsertBelow,
  onUseAsTitle,
  disabled,
}: WikiAiMenuProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<MenuState>({ step: 'menu' })

  function close() {
    setOpen(false)
    setState({ step: 'menu' })
  }

  async function start(action: WikiAiAction) {
    const text = getText().trim()
    if (!text) {
      setState({
        step: 'error',
        action,
        message: 'Este bloco não tem texto para a IA trabalhar.',
      })
      return
    }
    setState({ step: 'loading', action })
    try {
      const result = await run(action, text)
      setState({ step: 'result', action, text: result.trim() })
    } catch (error) {
      setState({ step: 'error', action, message: wikiAiErrorMessage(error) })
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label='IA neste bloco'
            title='IA neste bloco'
            className='text-muted-foreground'
            data-plate-prevent-deselect
          />
        }
      >
        <SteelIcon icon={SparklesIcon} strokeWidth={2} size={14} />
      </PopoverTrigger>
      <PopoverContent
        align='start'
        side='bottom'
        className='w-[min(22rem,calc(100vw-2rem))] p-1'
        aria-label='IA neste bloco'
      >
        {state.step === 'menu' && (
          <ul aria-label='Ações de IA'>
            {WIKI_BLOCK_AI_ACTIONS.map(({ action, label }) => (
              <li key={action}>
                <button
                  type='button'
                  onClick={() => start(action)}
                  className='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent'
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        )}

        {state.step === 'loading' && (
          <output className='flex items-center gap-2 px-2 py-3 text-muted-foreground text-sm'>
            <SteelIcon
              icon={Loading03Icon}
              strokeWidth={2}
              className='animate-spin'
            />
            Gerando com IA…
          </output>
        )}

        {state.step === 'error' && (
          <div className='space-y-2 p-2'>
            <p role='alert' className='text-destructive text-sm'>
              {state.message}
            </p>
            <div className='flex justify-end gap-1'>
              <Button
                variant='ghost'
                size='xs'
                onClick={() => setState({ step: 'menu' })}
              >
                Voltar
              </Button>
              <Button variant='ghost' size='xs' onClick={close}>
                Fechar
              </Button>
            </div>
          </div>
        )}

        {state.step === 'result' && (
          <div className='space-y-2 p-2'>
            <p
              data-testid='wiki-ai-preview'
              className='max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-sm'
            >
              {state.text}
            </p>
            <div className='flex flex-wrap justify-end gap-1'>
              <Button variant='ghost' size='xs' onClick={close}>
                Descartar
              </Button>
              {state.action === 'title' ? (
                <Button
                  size='xs'
                  onClick={() => {
                    onUseAsTitle(state.text)
                    close()
                  }}
                >
                  Usar como título da página
                </Button>
              ) : (
                <>
                  <Button
                    variant='outline'
                    size='xs'
                    onClick={() => {
                      onInsertBelow(state.text)
                      close()
                    }}
                  >
                    Inserir abaixo
                  </Button>
                  <Button
                    size='xs'
                    onClick={() => {
                      onReplace(state.text)
                      close()
                    }}
                  >
                    Substituir
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** What the per-block AI needs from the page around the editor. */
export interface WikiBlockAiContextValue {
  run: (action: WikiAiAction, text: string) => Promise<string>
  onUseAsTitle: (text: string) => void
}

export const WikiBlockAiContext = createContext<WikiBlockAiContextValue | null>(
  null,
)

/** `BlockGutterSlot` for the wiki editor: the AI menu bound to the block. */
export const WikiBlockAiSlot: BlockGutterSlot = ({ element, top }) => {
  const editor = useEditorRef()
  const context = useContext(WikiBlockAiContext)
  if (!context) return null

  function pathOf(node: TElement) {
    return editor.api.findPath(node)
  }

  return (
    <div
      className='pointer-events-auto mr-0.5 flex items-start max-sm:hidden'
      style={{ paddingTop: top }}
    >
      <WikiAiMenu
        getText={() => NodeApi.string(element)}
        run={context.run}
        onUseAsTitle={context.onUseAsTitle}
        onReplace={(text) => {
          const path = pathOf(element)
          if (!path) return
          const blocks = markdownToBlocks(editor, text)
          const only = blocks[0] as TElement | undefined
          editor.tf.withoutNormalizing(() => {
            if (blocks.length === 1 && only?.type === 'p') {
              // Keep the block's own type (heading, quote…): swap its text.
              editor.tf.replaceNodes(only.children, {
                at: path,
                children: true,
              })
            } else {
              editor.tf.removeNodes({ at: path })
              editor.tf.insertNodes(blocks, { at: path })
            }
          })
        }}
        onInsertBelow={(text) => {
          const path = pathOf(element)
          if (!path) return
          editor.tf.insertNodes(markdownToBlocks(editor, text), {
            at: PathApi.next(path),
          })
        }}
      />
    </div>
  )
}
