'use client'

import {
  Copy01Icon,
  Loading03Icon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { notify } from '@/lib/notify'
import { wikiAiErrorMessage } from './wiki-block-ai'

type SummaryState =
  | { step: 'idle' }
  | { step: 'loading' }
  | { step: 'done'; text: string }
  | { step: 'error'; message: string }

/**
 * "Resumo com IA": summarizes the whole page (its markdown) and offers to
 * insert the summary at the top or copy it.
 */
export function WikiAiSummaryButton({
  getMarkdown,
  summarize,
  onInsertAtTop,
  disabled,
}: {
  getMarkdown: () => string
  summarize: (markdown: string) => Promise<string>
  onInsertAtTop?: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<SummaryState>({ step: 'idle' })

  async function run() {
    setOpen(true)
    const markdown = getMarkdown().trim()
    if (!markdown) {
      setState({
        step: 'error',
        message: 'A página ainda não tem texto para resumir.',
      })
      return
    }
    setState({ step: 'loading' })
    try {
      const text = await summarize(markdown)
      setState({ step: 'done', text: text.trim() })
    } catch (error) {
      setState({ step: 'error', message: wikiAiErrorMessage(error) })
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify.success('Resumo copiado')
    } catch {
      notify.error('Não foi possível copiar o resumo')
    }
  }

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        disabled={disabled}
        onClick={run}
        title='Resumo com IA'
        className='shrink-0'
      >
        <SteelIcon icon={SparklesIcon} strokeWidth={2} />
        <span className='max-lg:sr-only'>Resumo com IA</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>Resumo com IA</DialogTitle>
            <DialogDescription>
              Um resumo do conteúdo desta página.
            </DialogDescription>
          </DialogHeader>
          {state.step === 'loading' && (
            <output className='flex items-center gap-2 py-6 text-muted-foreground text-sm'>
              <SteelIcon
                icon={Loading03Icon}
                strokeWidth={2}
                className='animate-spin'
              />
              Resumindo a página…
            </output>
          )}
          {state.step === 'error' && (
            <p role='alert' className='py-2 text-destructive text-sm'>
              {state.message}
            </p>
          )}
          {state.step === 'done' && (
            <p
              data-testid='wiki-ai-summary'
              className='max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm'
            >
              {state.text}
            </p>
          )}
          {state.step === 'done' && (
            <DialogFooter>
              <Button variant='outline' onClick={() => copy(state.text)}>
                <SteelIcon icon={Copy01Icon} strokeWidth={2} />
                Copiar
              </Button>
              {onInsertAtTop && (
                <Button
                  onClick={() => {
                    onInsertAtTop(state.text)
                    setOpen(false)
                  }}
                >
                  Inserir no topo
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
