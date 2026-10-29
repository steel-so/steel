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
import { useEmailEditorData } from '@/app/_components/crm/email-editor/editor-data'
import {
  PREHEADER_MAX,
  SUBJECT_MAX,
} from '@/app/_components/crm/email-editor/envelope-fields'
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
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import type { EmailBodyProps } from '@/src/lib/canvas-email/schemas'
import { CrmNewsletterSlugSchema } from '@/src/schemas/crm-newsletter.schema'
import {
  formatIssueDateTime,
  ISSUE_STATUS_LABEL,
  newsletterHref,
} from '../issue-format'
import { useIssueEditor } from './issue-editor-context'

/** Issue subject is capped at 200 by the API (template subjects at 300). */
const ISSUE_SUBJECT_MAX = Math.min(SUBJECT_MAX, 200)

/**
 * Left side of the issue editor's top bar: back to the newsletter, the
 * subject (inline, autosaved), and a popover with the preheader (root of
 * the canvas document) and the web version address.
 */
export function IssueEnvelope() {
  const { meta } = useEmailEditorData()
  const issue = useIssueEditor()
  const store = useCanvasStoreApi()
  const subject = useTemplateMeta(meta, (m) => m.subject)
  const root = useCanvasNode(store.getState().doc.rootId)
  const preheader = (root?.props as EmailBodyProps | undefined)?.preheader ?? ''
  const [open, setOpen] = useState(false)
  const [slug, setSlug] = useState(issue.initialSlug)
  const [savedSlug, setSavedSlug] = useState(issue.initialSlug)
  const [savingSlug, setSavingSlug] = useState(false)
  const preheaderId = useId()
  const slugId = useId()
  const back = newsletterHref(issue.slug, issue.newsletterId)
  const slugCheck = CrmNewsletterSlugSchema.safeParse(slug)

  async function saveSlug() {
    if (!slugCheck.success || slugCheck.data === savedSlug) return
    setSavingSlug(true)
    try {
      const saved = await issue.save({ slug: slugCheck.data })
      setSavedSlug(saved.slug)
      setSlug(saved.slug)
      notify.success('Endereço da edição salvo')
    } catch (error) {
      notify.error(error)
    } finally {
      setSavingSlug(false)
    }
  }

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <Link
        href={back}
        aria-label='Voltar para a newsletter'
        title='Voltar para a newsletter'
        className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      >
        <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
      </Link>
      <input
        aria-label='Assunto da edição'
        value={subject}
        maxLength={ISSUE_SUBJECT_MAX}
        placeholder='Assunto da edição'
        onChange={(event) =>
          meta.set({ name: event.target.value, subject: event.target.value })
        }
        className={cn(
          'h-8 w-48 min-w-0 shrink rounded-md border border-transparent bg-transparent px-2 font-medium text-sm outline-none transition-colors hover:border-input focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 xl:w-72 2xl:w-96',
          !subject.trim() && 'border-destructive/60',
        )}
      />
      {issue.status === 'SCHEDULED' ? (
        <Badge variant='secondary' className='hidden lg:inline-flex'>
          {ISSUE_STATUS_LABEL.SCHEDULED} ·{' '}
          {formatIssueDateTime(issue.scheduledAt)}
        </Badge>
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label='Pré-visualização e endereço da edição'
          className='flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-left text-xs shadow-xs outline-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30'
        >
          <SteelIcon
            icon={Mail01Icon}
            className='size-3.5 shrink-0 text-muted-foreground'
          />
          <span className='hidden truncate sm:inline'>Detalhes</span>
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
          <div className='grid gap-1.5'>
            <Label htmlFor={slugId}>Endereço da versão web</Label>
            <div className='flex gap-2'>
              <Input
                id={slugId}
                value={slug}
                maxLength={60}
                aria-invalid={!slugCheck.success || undefined}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
              />
              <Button
                type='button'
                variant='outline'
                disabled={
                  !slugCheck.success ||
                  slugCheck.data === savedSlug ||
                  savingSlug
                }
                onClick={() => void saveSlug()}
              >
                Salvar
              </Button>
            </div>
            <p className='text-[11px] text-muted-foreground'>
              {slugCheck.success
                ? 'Aparece no arquivo público da newsletter depois do envio.'
                : slugCheck.error.issues[0]?.message}
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
