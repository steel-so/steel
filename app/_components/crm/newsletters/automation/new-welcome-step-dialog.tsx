'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import { useCreateCrmNewsletterWelcomeStep } from '@/src/hooks/use-crm-newsletter-automation'
import {
  CRM_NEWSLETTER_DELAY_UNITS,
  CreateCrmNewsletterWelcomeStepSchema,
  type CrmNewsletterDelayUnitValue,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { DELAY_UNIT_LABEL, welcomeStepEditorHref } from './automation-format'

/**
 * "Nova etapa" of the welcome series: subject and the delay after the
 * confirmation. The content starts from the newsletter's template (or a
 * blank e-mail) and opens in the full-screen editor.
 */
export function NewWelcomeStepDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  newsletterId,
  isFirst,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  /** First step: suggests "right after the confirmation". */
  isFirst: boolean
}) {
  const router = useRouter()
  const create = useCreateCrmNewsletterWelcomeStep(workspaceId, newsletterId)
  const [subject, setSubject] = useState('')
  const [delayValue, setDelayValue] = useState('0')
  const [delayUnit, setDelayUnit] =
    useState<CrmNewsletterDelayUnitValue>('DAYS')
  const subjectId = useId()
  const delayId = useId()
  const unitId = useId()

  useEffect(() => {
    if (!open) return
    setSubject(isFirst ? 'Boas-vindas!' : '')
    setDelayValue(isFirst ? '0' : '2')
    setDelayUnit('DAYS')
  }, [open, isFirst])

  const parsed = CreateCrmNewsletterWelcomeStepSchema.safeParse({
    subject,
    delayValue,
    delayUnit,
  })
  const problem = parsed.success ? null : parsed.error.issues[0]?.message

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!parsed.success) return
    create.mutate(parsed.data, {
      onSuccess: (step) => {
        onOpenChange(false)
        router.push(welcomeStepEditorHref(workspaceSlug, newsletterId, step.id))
      },
      onError: (error) => notify.error(error),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Nova etapa de boas-vindas</DialogTitle>
            <DialogDescription>
              O e-mail sai para cada novo assinante depois da confirmação da
              inscrição, no tempo que você escolher.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={subjectId}>Assunto</Label>
            <Input
              id={subjectId}
              value={subject}
              maxLength={200}
              autoFocus
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3'>
            <div className='flex min-w-0 flex-col gap-1.5'>
              <Label htmlFor={delayId}>Enviar depois de</Label>
              <Input
                id={delayId}
                type='number'
                inputMode='numeric'
                min={0}
                value={delayValue}
                onChange={(event) => setDelayValue(event.target.value)}
              />
            </div>
            <div className='flex min-w-0 flex-col gap-1.5'>
              <Label htmlFor={unitId}>Unidade</Label>
              <Select
                value={delayUnit}
                onValueChange={(value) =>
                  setDelayUnit(value as CrmNewsletterDelayUnitValue)
                }
              >
                <SelectTrigger id={unitId} className='w-full'>
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
            </div>
          </div>
          <p className='text-muted-foreground text-xs'>
            {problem ?? 'Use 0 para enviar logo após a confirmação.'}
          </p>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              disabled={!parsed.success || create.isPending}
            >
              Criar e abrir o editor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
