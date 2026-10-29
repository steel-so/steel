'use client'

import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  Clock01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useId, useState } from 'react'
import {
  useCanvasNode,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
import { PREHEADER_MAX } from '@/app/_components/crm/email-editor/envelope-fields'
import { useTemplateMeta } from '@/app/_components/crm/email-editor/template-meta'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { EmailBodyProps } from '@/src/lib/canvas-email/schemas'
import {
  CRM_NEWSLETTER_DELAY_UNITS,
  type CrmNewsletterDelayUnitValue,
  UpdateCrmNewsletterWelcomeStepSchema,
} from '@/src/schemas/crm-newsletter-automation.schema'
import {
  DELAY_UNIT_LABEL,
  delayLabel,
  welcomeTabHref,
} from '../automation-format'
import { useWelcomeStepEditor } from './welcome-step-editor-context'

const SUBJECT_MAX = 200

/**
 * Left side of the welcome step editor's top bar: back to the "Boas-vindas"
 * tab, the subject (inline, autosaved), and a popover with the preheader
 * (root of the canvas document) and the delay after the confirmation.
 */
export function WelcomeStepEnvelope() {
  const { meta } = useEmailEditorData()
  const step = useWelcomeStepEditor()
  const store = useCanvasStoreApi()
  const subject = useTemplateMeta(meta, (m) => m.subject)
  const root = useCanvasNode(store.getState().doc.rootId)
  const preheader = (root?.props as EmailBodyProps | undefined)?.preheader ?? ''
  const [open, setOpen] = useState(false)
  const [delayValue, setDelayValue] = useState(String(step.initialDelay.value))
  const [delayUnit, setDelayUnit] = useState<CrmNewsletterDelayUnitValue>(
    step.initialDelay.unit,
  )
  const [saved, setSaved] = useState(step.initialDelay)
  const [saving, setSaving] = useState(false)
  const preheaderId = useId()
  const delayId = useId()
  const unitId = useId()

  const check = UpdateCrmNewsletterWelcomeStepSchema.safeParse({
    delayValue,
    delayUnit,
  })
  const changed =
    check.success &&
    (check.data.delayValue !== saved.value ||
      check.data.delayUnit !== saved.unit)

  async function saveDelay() {
    if (!check.success || !changed) return
    setSaving(true)
    try {
      const updated = await step.save({
        delayValue: check.data.delayValue,
        delayUnit: check.data.delayUnit,
      })
      setSaved({ value: updated.delayValue, unit: updated.delayUnit })
      notify.success('Atraso da etapa salvo')
    } catch (error) {
      notify.error(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <Link
        href={welcomeTabHref(step.workspaceSlug, step.newsletterId)}
        aria-label='Voltar para a série de boas-vindas'
        title='Voltar para a série de boas-vindas'
        className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      >
        <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
      </Link>
      <Badge variant='secondary' className='hidden shrink-0 md:inline-flex'>
        Etapa {step.position + 1}
      </Badge>
      <input
        aria-label='Assunto da etapa'
        value={subject}
        maxLength={SUBJECT_MAX}
        placeholder='Assunto do e-mail'
        onChange={(event) =>
          meta.set({ name: event.target.value, subject: event.target.value })
        }
        className={cn(
          'h-8 w-40 min-w-0 shrink rounded-md border border-transparent bg-transparent px-2 font-medium text-sm outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 xl:w-72 2xl:w-96',
          !subject.trim() && 'border-destructive/60',
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label='Atraso e pré-visualização da etapa'
          className='flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-left text-xs shadow-xs outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
        >
          <SteelIcon
            icon={Clock01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
          <span className='hidden max-w-56 truncate sm:inline'>
            {delayLabel(saved.value, saved.unit)}
          </span>
          <SteelIcon
            icon={ArrowDown01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
        </PopoverTrigger>
        <PopoverContent
          align='start'
          className='w-96 max-w-[calc(100vw-2rem)] gap-4 p-4'
        >
          <div className='grid gap-1.5'>
            <Label htmlFor={delayId}>Enviar depois da confirmação</Label>
            <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2'>
              <Input
                id={delayId}
                type='number'
                inputMode='numeric'
                min={0}
                value={delayValue}
                aria-invalid={!check.success || undefined}
                onChange={(event) => setDelayValue(event.target.value)}
              />
              <Select
                value={delayUnit}
                onValueChange={(value) =>
                  setDelayUnit(value as CrmNewsletterDelayUnitValue)
                }
              >
                <SelectTrigger
                  id={unitId}
                  className='w-full'
                  aria-label='Unidade'
                >
                  <SelectValue>
                    {(value: CrmNewsletterDelayUnitValue) =>
                      DELAY_UNIT_LABEL[value]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CRM_NEWSLETTER_DELAY_UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {DELAY_UNIT_LABEL[unit]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type='button'
                variant='outline'
                disabled={!changed || saving}
                onClick={() => void saveDelay()}
              >
                Salvar
              </Button>
            </div>
            <p className='text-[11px] text-muted-foreground'>
              {check.success
                ? 'Use 0 para enviar logo após a confirmação.'
                : check.error.issues[0]?.message}
            </p>
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
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
