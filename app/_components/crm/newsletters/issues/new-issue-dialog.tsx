'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { OptionSelect } from '@/app/_components/crm/email-editor/option-select'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { notify } from '@/lib/notify'
import { useCreateCrmNewsletterIssue } from '@/src/hooks/use-crm-newsletter-issues'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import type { CrmNewsletterIssueDTO } from '@/src/schemas/crm-newsletter-issue.schema'
import type { CrmEmailTemplateDTO } from '@/types/crm-email-marketing'
import { issueEditorHref } from './issue-format'

type Source = 'newsletter' | 'template'

/**
 * "Nova edição": subject and where the content starts from — the
 * newsletter's template (or a blank e-mail when it has none), another
 * template, or a copy of an issue (opened from "Duplicar" on a row).
 */
export function NewIssueDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
  newsletterId,
  duplicateOf,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  duplicateOf: CrmNewsletterIssueDTO | null
}) {
  const router = useRouter()
  const create = useCreateCrmNewsletterIssue(workspaceId, newsletterId)
  const { items: templates } = useCrmResourceList<CrmEmailTemplateDTO>(
    workspaceId,
    'email-templates',
  )
  const [subject, setSubject] = useState('')
  const [source, setSource] = useState<Source>('newsletter')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const subjectId = useId()
  const templateSelectId = useId()

  useEffect(() => {
    if (!open) return
    setSubject(duplicateOf ? duplicateOf.subject : '')
    setSource('newsletter')
    setTemplateId(null)
  }, [open, duplicateOf])

  const builderTemplates = templates.filter(
    (template) => template.kind === 'BUILDER',
  )
  const missingTemplate = source === 'template' && !templateId
  const canSubmit = subject.trim().length > 0 && !missingTemplate

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    create.mutate(
      {
        subject: subject.trim(),
        ...(duplicateOf ? { duplicateOfIssueId: duplicateOf.id } : {}),
        ...(!duplicateOf && source === 'template' && templateId
          ? { templateId }
          : {}),
      },
      {
        onSuccess: (issue) => {
          onOpenChange(false)
          router.push(issueEditorHref(workspaceSlug, newsletterId, issue.id))
        },
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>
              {duplicateOf ? 'Duplicar edição' : 'Nova edição'}
            </DialogTitle>
            <DialogDescription>
              {duplicateOf
                ? `O conteúdo de “${duplicateOf.subject}” é copiado para um novo rascunho.`
                : 'Dê um assunto e escolha de onde o conteúdo começa. Você edita tudo no editor em seguida.'}
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-1.5'>
            <Label htmlFor={subjectId}>Assunto</Label>
            <Input
              id={subjectId}
              value={subject}
              maxLength={200}
              autoFocus
              placeholder='Ex.: Novidades de outubro'
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          {duplicateOf ? null : (
            <div className='grid gap-2'>
              <Label>Começar de</Label>
              <RadioGroup
                value={source}
                onValueChange={(value) => setSource(value as Source)}
                className='grid gap-2'
              >
                <Label className='flex items-start gap-2 font-normal'>
                  <RadioGroupItem value='newsletter' />
                  <span>
                    Modelo da newsletter
                    <span className='block text-muted-foreground text-xs'>
                      Ou um e-mail em branco, se a newsletter não tiver modelo.
                    </span>
                  </span>
                </Label>
                <Label className='flex items-start gap-2 font-normal'>
                  <RadioGroupItem value='template' />
                  <span>Outro modelo de e-mail</span>
                </Label>
              </RadioGroup>
              {source === 'template' ? (
                builderTemplates.length > 0 ? (
                  <OptionSelect
                    id={templateSelectId}
                    label='Modelo de e-mail'
                    value={templateId}
                    onChange={setTemplateId}
                    placeholder='Escolha um modelo'
                    options={builderTemplates.map((template) => ({
                      value: template.id,
                      label: template.name,
                    }))}
                  />
                ) : (
                  <p className='text-muted-foreground text-xs'>
                    Nenhum modelo do editor visual ainda. Crie um em CRM ›
                    Modelos de e-mail.
                  </p>
                )
              ) : null}
            </div>
          )}

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={!canSubmit || create.isPending}>
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              {create.isPending ? 'Criando…' : 'Criar e abrir o editor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
