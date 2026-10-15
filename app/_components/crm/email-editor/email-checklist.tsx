'use client'

import {
  Alert02Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  TaskDone01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useMemo, useState } from 'react'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { useCanvasStore } from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  type EmailChecklistItem,
  emailChecklist,
} from '@/src/lib/canvas-email/checklist'
import { useEmailEditorData } from './editor-data'
import { useTemplateMeta } from './template-meta'
import { useRenderedEmail } from './use-email-render'

export type ChecklistSummary = {
  items: EmailChecklistItem[]
  errors: EmailChecklistItem[]
  warnings: EmailChecklistItem[]
}

export function summarizeChecklist(
  items: EmailChecklistItem[],
): ChecklistSummary {
  return {
    items,
    errors: items.filter((item) => item.level === 'error'),
    warnings: items.filter((item) => item.level === 'warning'),
  }
}

/**
 * Pre-send checklist of the document being edited. Without `withSize` it
 * runs on the document alone (cheap, for the top-bar badge); with it the
 * e-mail is also rendered for the Gmail size check.
 */
export function useEmailChecklist(
  options: { withSize?: boolean } = {},
): ChecklistSummary {
  const { meta } = useEmailEditorData()
  const subject = useTemplateMeta(meta, (m) => m.subject)
  const doc = useCanvasStore((state) => state.doc)
  // The badge does not need to follow every keystroke.
  const [settled, setSettled] = useState<CanvasDocument>(doc)
  useEffect(() => {
    const handle = setTimeout(() => setSettled(doc), 250)
    return () => clearTimeout(handle)
  }, [doc])
  const rendered = useRenderedEmail(options.withSize ? settled : null, subject)
  return useMemo(
    () =>
      summarizeChecklist(
        emailChecklist({
          doc: settled,
          subject,
          html: options.withSize ? rendered?.html : undefined,
        }),
      ),
    [settled, subject, rendered, options.withSize],
  )
}

/** The checklist items; clicking one selects its block on the canvas. */
export function ChecklistList({
  summary,
  onPick,
}: {
  summary: ChecklistSummary
  onPick?: () => void
}) {
  const { store } = useCanvasEditor()
  if (summary.items.length === 0) {
    return (
      <div className='flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-3'>
        <SteelIcon
          icon={CheckmarkCircle02Icon}
          className='size-5 shrink-0 text-primary'
        />
        <div className='text-xs'>
          <p className='font-medium text-foreground'>Tudo certo para enviar</p>
          <p className='text-muted-foreground'>
            Assunto, pré-visualização, imagens, links e variáveis conferidos.
          </p>
        </div>
      </div>
    )
  }
  const ordered = [...summary.errors, ...summary.warnings]
  return (
    <ul className='flex flex-col gap-1' aria-label='Itens do checklist'>
      {ordered.map((item, index) => {
        const error = item.level === 'error'
        const content = (
          <>
            <SteelIcon
              icon={error ? CancelCircleIcon : Alert02Icon}
              className={cn(
                'mt-px size-4 shrink-0',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            />
            <span className='min-w-0 flex-1'>
              <span className='block text-foreground'>{item.message}</span>
              <span
                className={cn(
                  'text-[11px]',
                  error ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {error ? 'Impede o envio' : 'Recomendado corrigir'}
              </span>
            </span>
            {item.nodeId ? (
              <SteelIcon
                icon={ArrowRight01Icon}
                className='mt-px size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100'
              />
            ) : null}
          </>
        )
        const key = `${item.code}-${item.nodeId ?? ''}-${index}`
        return (
          <li key={key}>
            {item.nodeId ? (
              <button
                type='button'
                onClick={() => {
                  store.select(item.nodeId as string)
                  onPick?.()
                }}
                className='group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'
              >
                {content}
              </button>
            ) : (
              <div className='flex items-start gap-2 px-2 py-1.5 text-xs'>
                {content}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Top-bar "Checklist" button with the count of problems. */
export function ChecklistButton() {
  const [open, setOpen] = useState(false)
  const summary = useEmailChecklist({ withSize: open })
  const count = summary.items.length
  const label =
    summary.errors.length > 0
      ? `${summary.errors.length} ${summary.errors.length === 1 ? 'erro' : 'erros'}`
      : count > 0
        ? `${count} ${count === 1 ? 'aviso' : 'avisos'}`
        : 'Nenhum problema'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            aria-label={`Checklist: ${label}`}
            data-testid='email-checklist-trigger'
          />
        }
      >
        <SteelIcon icon={TaskDone01Icon} strokeWidth={2} />
        Checklist
        {count > 0 ? (
          <span
            className={cn(
              'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
              summary.errors.length > 0
                ? 'bg-destructive/15 text-destructive'
                : 'bg-muted-foreground/20 text-foreground',
            )}
          >
            {count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 gap-3 p-3'>
        <div>
          <p className='font-medium text-sm'>Checklist de envio</p>
          <p className='text-muted-foreground text-xs'>
            Erros impedem o teste e o envio; avisos são recomendações.
          </p>
        </div>
        <div className='max-h-80 overflow-y-auto'>
          <ChecklistList summary={summary} onPick={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
