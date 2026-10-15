'use client'

import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Mail01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useId, useState } from 'react'
import {
  useCanvasNode,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import type { EmailBodyProps } from '@/src/lib/canvas-email/schemas'
import { campaignReturnHref, useEmailEditorData } from './editor-data'
import { useTemplateMeta } from './template-meta'

export const SUBJECT_MAX = 300
export const PREHEADER_MAX = 150

/**
 * Left side of the top bar: back to the list, the template name (inline)
 * and the envelope — subject and preheader — in a popover whose button
 * shows the subject.
 */
export function EnvelopeFields() {
  const { slug, meta, returnTo, templateId } = useEmailEditorData()
  const back = returnTo
    ? {
        href: campaignReturnHref(returnTo, templateId),
        label: 'Voltar para a campanha',
      }
    : {
        href: `/${slug}/crm/email-templates`,
        label: 'Voltar para os templates',
      }
  const store = useCanvasStoreApi()
  const name = useTemplateMeta(meta, (m) => m.name)
  const subject = useTemplateMeta(meta, (m) => m.subject)
  const root = useCanvasNode(store.getState().doc.rootId)
  const preheader = (root?.props as EmailBodyProps | undefined)?.preheader ?? ''
  const [open, setOpen] = useState(false)
  const subjectId = useId()
  const preheaderId = useId()

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <Link
        href={back.href}
        aria-label={back.label}
        title={back.label}
        className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
      </Link>
      <input
        aria-label='Nome do template'
        value={name}
        maxLength={200}
        placeholder='Nome do template'
        onChange={(event) => meta.set({ name: event.target.value })}
        className={cn(
          'h-8 w-48 min-w-0 shrink rounded-md border border-transparent bg-transparent px-2 font-medium text-sm outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 xl:w-64 2xl:w-80',
          !name.trim() && 'border-destructive/60',
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          data-testid='envelope-trigger'
          aria-label={`Assunto e pré-visualização: ${subject || 'sem assunto'}`}
          className='flex h-8 min-w-0 max-w-72 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-left text-xs shadow-xs outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
        >
          <SteelIcon
            icon={Mail01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
          <span
            className={cn(
              'min-w-0 truncate',
              subject.trim() ? 'text-foreground' : 'text-destructive',
            )}
          >
            {subject.trim() || 'Sem assunto'}
          </span>
          <SteelIcon
            icon={ArrowDown01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-96 gap-4 p-4'
          data-testid='envelope-popover'
        >
          <div className='grid gap-1.5'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor={subjectId}>Assunto</Label>
              <span className='text-[11px] text-muted-foreground tabular-nums'>
                {subject.length}/{SUBJECT_MAX}
              </span>
            </div>
            <Input
              id={subjectId}
              value={subject}
              maxLength={SUBJECT_MAX}
              placeholder='Ex.: {{primeiro_nome}}, temos uma novidade'
              aria-invalid={!subject.trim() || undefined}
              onChange={(event) => meta.set({ subject: event.target.value })}
            />
          </div>
          <div className='grid gap-1.5'>
            <div className='flex items-baseline justify-between'>
              <Label htmlFor={preheaderId}>Texto de pré-visualização</Label>
              <span className='text-[11px] text-muted-foreground tabular-nums'>
                {preheader.length}/{PREHEADER_MAX}
              </span>
            </div>
            <Textarea
              id={preheaderId}
              rows={2}
              value={preheader}
              maxLength={PREHEADER_MAX}
              placeholder='Aparece ao lado do assunto na caixa de entrada'
              onChange={(event) =>
                root &&
                store.dispatch({
                  kind: 'update',
                  id: root.id,
                  set: { preheader: event.target.value },
                })
              }
            />
            <p className='text-[11px] text-muted-foreground'>
              Entre 40 e 130 caracteres funciona melhor. Use as variáveis da aba
              Variáveis, como {'{{primeiro_nome}}'}.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
