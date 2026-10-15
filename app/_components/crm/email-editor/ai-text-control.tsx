'use client'

import {
  AiEditingIcon,
  ArrowDown01Icon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { rewriteCrmEmailBlock } from '@/src/hooks/use-crm-email-editor'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import {
  EMAIL_AI_FIELDS,
  EMAIL_AI_MODE_LABELS,
  type EmailAiMode,
} from '@/src/lib/canvas-email/ai-blocks'
import { useEmailEditorData } from './editor-data'

const REWRITES: EmailAiMode[] = ['shorter', 'persuasive', 'formal']

/**
 * "IA" of a text block (E3): "Escrever com IA" from a request and
 * "Reescrever" (mais curto / mais persuasivo / mais formal). The value
 * comes back validated for the field and lands as one undo step.
 */
export function AiTextControl({ value, onChange, node }: CustomControlProps) {
  const { workspaceId, meta } = useEmailEditorData()
  const [pending, setPending] = useState(false)
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const field = EMAIL_AI_FIELDS[node.type]
  const text = typeof value === 'string' ? value : ''
  const empty = !text.replace(/<[^>]+>/g, '').trim()
  if (!field) return null

  const run = async (mode: EmailAiMode, request = '') => {
    setPending(true)
    try {
      const result = await rewriteCrmEmailBlock(workspaceId, {
        blockType: node.type,
        mode,
        text,
        prompt: request,
        subject: meta.get().subject,
      })
      onChange(result.value)
      notify.success('Texto atualizado pela IA — Ctrl+Z desfaz')
      return true
    } catch (error) {
      notify.error(error)
      return false
    } finally {
      setPending(false)
    }
  }
  return (
    <div className='flex flex-col gap-2' data-testid='ai-text-control'>
      <div className='flex gap-1.5'>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='min-w-0 flex-1'
                disabled={pending}
                data-testid='ai-write'
              >
                <SteelIcon icon={SparklesIcon} strokeWidth={2} />
                {pending ? 'Escrevendo…' : 'Escrever com IA'}
              </Button>
            }
          />
          <PopoverContent align='start' className='w-72 p-3'>
            <form
              className='flex flex-col gap-2'
              onSubmit={async (event) => {
                event.preventDefault()
                if (!prompt.trim()) return
                if (await run('write', prompt.trim())) {
                  setOpen(false)
                  setPrompt('')
                }
              }}
            >
              <label
                htmlFor='ai-write-prompt'
                className='text-xs font-medium text-foreground/80'
              >
                O que escrever em “{field.label}”?
              </label>
              <Textarea
                id='ai-write-prompt'
                value={prompt}
                maxLength={1000}
                rows={3}
                placeholder='Ex.: convite para o webinar de quinta, tom animado'
                onChange={(event) => setPrompt(event.target.value)}
                className='text-xs'
              />
              <Button
                type='submit'
                size='sm'
                disabled={pending || !prompt.trim()}
              >
                {pending ? 'Escrevendo…' : 'Escrever'}
              </Button>
            </form>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={pending || empty}
                data-testid='ai-rewrite'
                title={empty ? 'Escreva algo antes de reescrever' : undefined}
              >
                <SteelIcon icon={AiEditingIcon} strokeWidth={2} />
                Reescrever
                <SteelIcon icon={ArrowDown01Icon} className='size-3' />
              </Button>
            }
          />
          <DropdownMenuContent align='end' className='w-44'>
            {REWRITES.map((mode) => (
              <DropdownMenuItem
                key={mode}
                onClick={() => void run(mode)}
                data-testid={`ai-rewrite-${mode}`}
              >
                {EMAIL_AI_MODE_LABELS[mode]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className='text-[11px] text-muted-foreground'>
        Usa a IA do workspace e conta na cota mensal.
      </p>
    </div>
  )
}
