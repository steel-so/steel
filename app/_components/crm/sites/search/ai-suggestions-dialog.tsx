'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import type { SearchApplyDTO } from '@/src/schemas/site-search.schema'
import type { SiteSearchAiOptimizeDTO } from '@/types/site-search'

/**
 * Review of "Otimizar com IA": every suggestion side by side with the
 * current value, each one opt-in. Only what stays checked is applied.
 */

/** Key of one suggestion (`page:title`, `page:answer:2`). */
type Choice = string

export function initialChoices(result: SiteSearchAiOptimizeDTO): Set<Choice> {
  const out = new Set<Choice>()
  for (const item of result.items) {
    if (item.title) out.add(`${item.pageId}:title`)
    if (item.description) out.add(`${item.pageId}:description`)
    item.answers?.forEach((_, index) => {
      out.add(`${item.pageId}:answer:${index}`)
    })
  }
  return out
}

/** What `apply` receives for the checked suggestions. */
export function applyPayload(
  result: SiteSearchAiOptimizeDTO,
  chosen: Set<Choice>,
): SearchApplyDTO['items'] {
  return result.items
    .map((item) => {
      const answers =
        item.answers
          ?.map((answer, index) => ({ answer, index }))
          .filter(({ index }) => chosen.has(`${item.pageId}:answer:${index}`))
          .map(({ answer }) => ({
            question: answer.question,
            answer: answer.suggested,
          })) ?? []
      return {
        pageId: item.pageId,
        ...(item.title && chosen.has(`${item.pageId}:title`)
          ? { title: item.title.suggested }
          : {}),
        ...(item.description && chosen.has(`${item.pageId}:description`)
          ? { description: item.description.suggested }
          : {}),
        ...(answers.length ? { questions: answers } : {}),
      }
    })
    .filter((item) => Object.keys(item).length > 1)
}

function Suggestion({
  id,
  label,
  current,
  suggested,
  checked,
  onToggle,
}: {
  id: string
  label: string
  current: string
  suggested: string
  checked: boolean
  onToggle: (checked: boolean) => void
}) {
  return (
    <div className='flex gap-2 rounded-md border p-2'>
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onToggle(value === true)}
        className='mt-0.5'
      />
      <div className='grid min-w-0 flex-1 gap-1'>
        <Label htmlFor={id} className='font-medium text-xs'>
          {label}
        </Label>
        <p className='text-muted-foreground text-xs line-through decoration-muted-foreground/50'>
          {current || '(vazio)'}
        </p>
        <p className='text-xs'>{suggested}</p>
      </div>
    </div>
  )
}

export function AiSuggestionsDialog({
  result,
  onOpenChange,
  onApply,
}: {
  result: SiteSearchAiOptimizeDTO | null
  onOpenChange: (open: boolean) => void
  onApply: (items: SearchApplyDTO['items']) => Promise<boolean>
}) {
  const [chosen, setChosen] = useState<Set<Choice>>(new Set())
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (result) setChosen(initialChoices(result))
  }, [result])

  const toggle = (key: Choice, value: boolean) =>
    setChosen((current) => {
      const next = new Set(current)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })

  async function apply() {
    if (!result) return
    const items = applyPayload(result, chosen)
    if (!items.length) {
      notify.error('Marque pelo menos uma sugestão.')
      return
    }
    setSaving(true)
    const ok = await onApply(items)
    setSaving(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog open={result !== null} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl' data-testid='ai-suggestions'>
        <DialogHeader>
          <DialogTitle>Sugestões da IA</DialogTitle>
          <DialogDescription>
            Revise antes de aplicar. Nada muda no site até você publicar.
          </DialogDescription>
        </DialogHeader>
        <div className='grid max-h-[60vh] gap-4 overflow-y-auto'>
          {result?.items.map((item) => (
            <section key={item.pageId} className='grid gap-2'>
              <h3 className='font-medium text-sm'>{item.pageTitle}</h3>
              {item.title ? (
                <Suggestion
                  id={`${item.pageId}-title`}
                  label='Título nos buscadores'
                  current={item.title.current}
                  suggested={item.title.suggested}
                  checked={chosen.has(`${item.pageId}:title`)}
                  onToggle={(value) => toggle(`${item.pageId}:title`, value)}
                />
              ) : null}
              {item.description ? (
                <Suggestion
                  id={`${item.pageId}-description`}
                  label='Descrição'
                  current={item.description.current}
                  suggested={item.description.suggested}
                  checked={chosen.has(`${item.pageId}:description`)}
                  onToggle={(value) =>
                    toggle(`${item.pageId}:description`, value)
                  }
                />
              ) : null}
              {item.answers?.map((answer, index) => (
                <Suggestion
                  key={answer.question}
                  id={`${item.pageId}-answer-${index}`}
                  label={answer.question}
                  current={answer.current}
                  suggested={answer.suggested}
                  checked={chosen.has(`${item.pageId}:answer:${index}`)}
                  onToggle={(value) =>
                    toggle(`${item.pageId}:answer:${index}`, value)
                  }
                />
              ))}
              {!item.title && !item.description && !item.answers ? (
                <p className='text-muted-foreground text-xs'>
                  A IA não sugeriu mudanças para esta página.
                </p>
              ) : null}
            </section>
          ))}
          {result?.failed.length ? (
            <p className='text-muted-foreground text-xs' role='status'>
              Sem sugestões para:{' '}
              {result.failed.map((item) => item.pageTitle).join(', ')}. Tente de
              novo em instantes.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            Descartar
          </Button>
          <Button type='button' disabled={saving} onClick={() => void apply()}>
            {saving ? 'Aplicando…' : `Aplicar (${chosen.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
