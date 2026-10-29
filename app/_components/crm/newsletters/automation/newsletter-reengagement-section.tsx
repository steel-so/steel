'use client'

import { type FormEvent, useEffect, useId, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import {
  useCrmNewsletterReengagement,
  useCrmNewsletterReengagementPreview,
  useSaveCrmNewsletterReengagement,
} from '@/src/hooks/use-crm-newsletter-automation'
import {
  CRM_NEWSLETTER_REENGAGEMENT_ACTIONS,
  CRM_NEWSLETTER_REENGAGEMENT_LIMITS,
  type CrmNewsletterReengagementActionValue,
  type CrmNewsletterReengagementDTO,
  UpdateCrmNewsletterReengagementSchema,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { formatCount } from '../issues/issue-format'
import { REENGAGEMENT_ACTION_LABEL } from './automation-format'

type Form = {
  enabled: boolean
  minIssues: string
  inactiveDays: string
  graceDays: string
  action: CrmNewsletterReengagementActionValue
  subject: string
  heading: string
  body: string
  buttonLabel: string
}

function formOf(dto: CrmNewsletterReengagementDTO): Form {
  return {
    enabled: dto.enabled,
    minIssues: String(dto.minIssues),
    inactiveDays: String(dto.inactiveDays),
    graceDays: String(dto.graceDays),
    action: dto.action,
    subject: dto.subject,
    heading: dto.heading,
    body: dto.body,
    buttonLabel: dto.buttonLabel,
  }
}

function sameForm(a: Form, b: Form): boolean {
  return (Object.keys(a) as Array<keyof Form>).every((key) => a[key] === b[key])
}

/** Debounced copy of `value` (the preview query follows the typing). */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
  min: number
  max: number
}) {
  const id = useId()
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type='number'
        inputMode='numeric'
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className='text-muted-foreground text-xs'>{hint}</p>
    </div>
  )
}

function PreviewNumber({
  value,
  label,
  loading,
}: {
  value: number | undefined
  label: string
  loading: boolean
}) {
  return (
    <div className='flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/50 p-3'>
      {loading && value === undefined ? (
        <Skeleton className='h-6 w-12' />
      ) : (
        <span className='font-semibold text-lg tabular-nums'>
          {formatCount(value ?? 0)}
        </span>
      )}
      <span className='text-muted-foreground text-xs'>{label}</span>
    </div>
  )
}

/**
 * Re-engagement of inactive subscribers (newsletter2, nl2-automation),
 * mounted in the "Configurações" tab: off by default; who counts as
 * inactive (N issues, X days), the grace period (Y days), what happens
 * after it, the e-mail copy and a live preview of how many subscribers the
 * rule reaches now.
 */
export function NewsletterReengagementSection({
  workspaceId,
  newsletterId,
}: {
  workspaceId: string
  newsletterId: string
}) {
  const settings = useCrmNewsletterReengagement(workspaceId, newsletterId)
  const save = useSaveCrmNewsletterReengagement(workspaceId, newsletterId)
  const [form, setForm] = useState<Form | null>(null)
  const actionId = useId()
  const subjectId = useId()
  const headingId = useId()
  const bodyId = useId()
  const buttonId = useId()

  useEffect(() => {
    if (settings.data) setForm(formOf(settings.data))
  }, [settings.data])

  const parsed = form
    ? UpdateCrmNewsletterReengagementSchema.safeParse(form)
    : null
  const criteria =
    parsed?.success === true
      ? {
          minIssues: parsed.data.minIssues,
          inactiveDays: parsed.data.inactiveDays,
        }
      : null
  const debounced = useDebounced(criteria, 400)
  const sameAsSaved =
    debounced !== null &&
    settings.data !== undefined &&
    debounced.minIssues === settings.data.minIssues &&
    debounced.inactiveDays === settings.data.inactiveDays
  const preview = useCrmNewsletterReengagementPreview(
    workspaceId,
    newsletterId,
    sameAsSaved ? null : debounced,
  )
  const numbers = sameAsSaved ? settings.data?.preview : preview.data

  if (!form || !settings.data) {
    return <Skeleton className='h-64 w-full rounded-xl' />
  }
  const saved = settings.data
  const dirty = !sameForm(form, formOf(saved))
  const problem = parsed?.success ? null : parsed?.error.issues[0]?.message
  const { minIssues, inactiveDays, graceDays } =
    CRM_NEWSLETTER_REENGAGEMENT_LIMITS

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!parsed?.success) return
    save.mutate(parsed.data, {
      onSuccess: () => notify.success('Reengajamento salvo'),
      onError: (error) => notify.error(error),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='flex flex-col gap-4 rounded-xl border p-4'
      data-testid='reengagement-section'
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <h2 className='font-medium'>Reengajamento de inativos</h2>
            <Badge variant={saved.enabled ? 'secondary' : 'outline'}>
              {saved.enabled ? 'Ligado' : 'Desligado'}
            </Badge>
          </div>
          <p className='text-muted-foreground text-xs'>
            Uma vez por mês, quem parou de abrir a newsletter recebe um e-mail
            perguntando se quer continuar. Quem não responder no prazo sai da
            lista — o que protege a reputação do seu domínio.
          </p>
        </div>
        <Switch
          checked={form.enabled}
          onCheckedChange={(checked) => set('enabled', checked)}
          aria-label='Reengajamento de inativos'
        />
      </div>

      <div className='grid gap-4 sm:grid-cols-3'>
        <NumberField
          label='Edições recebidas'
          hint='Mínimo de edições recebidas no período.'
          value={form.minIssues}
          onChange={(value) => set('minIssues', value)}
          min={minIssues.min}
          max={minIssues.max}
        />
        <NumberField
          label='Dias sem abrir'
          hint='Período sem nenhuma abertura ou clique.'
          value={form.inactiveDays}
          onChange={(value) => set('inactiveDays', value)}
          min={inactiveDays.min}
          max={inactiveDays.max}
        />
        <NumberField
          label='Prazo para responder (dias)'
          hint='Tempo para abrir, clicar ou usar o botão.'
          value={form.graceDays}
          onChange={(value) => set('graceDays', value)}
          min={graceDays.min}
          max={graceDays.max}
        />
      </div>

      <div className='flex min-w-0 flex-col gap-1.5'>
        <Label htmlFor={actionId}>Se continuar inativo depois do prazo</Label>
        <Select
          value={form.action}
          onValueChange={(value) =>
            set('action', value as CrmNewsletterReengagementActionValue)
          }
        >
          <SelectTrigger id={actionId} className='w-full sm:w-80'>
            <SelectValue>
              {(value: CrmNewsletterReengagementActionValue) =>
                REENGAGEMENT_ACTION_LABEL[value]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CRM_NEWSLETTER_REENGAGEMENT_ACTIONS.map((action) => (
              <SelectItem key={action} value={action}>
                {REENGAGEMENT_ACTION_LABEL[action]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className='flex flex-col gap-2 rounded-lg border border-dashed p-3'
        aria-live='polite'
      >
        <p className='font-medium text-sm'>Se a regra rodasse agora</p>
        <div className='grid gap-2 sm:grid-cols-3'>
          <PreviewNumber
            value={numbers?.candidates}
            label='receberiam o e-mail de reengajamento'
            loading={preview.isFetching}
          />
          <PreviewNumber
            value={numbers?.waiting}
            label='já receberam e estão no prazo'
            loading={false}
          />
          <PreviewNumber
            value={numbers?.dueNow}
            label={
              form.action === 'UNSUBSCRIBE'
                ? 'seriam descadastrados na próxima rodada'
                : 'seriam marcados como inativos'
            }
            loading={false}
          />
        </div>
        {saved.totals.sent > 0 ? (
          <p className='text-muted-foreground text-xs'>
            Até hoje: {formatCount(saved.totals.sent)} e-mails de reengajamento,{' '}
            {formatCount(saved.totals.reengaged)} voltaram a interagir,{' '}
            {formatCount(saved.totals.unsubscribed)} descadastrados e{' '}
            {formatCount(saved.totals.flagged)} marcados como inativos.
          </p>
        ) : null}
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor={subjectId}>Assunto do e-mail</Label>
          <Input
            id={subjectId}
            value={form.subject}
            maxLength={200}
            onChange={(event) => set('subject', event.target.value)}
          />
        </div>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor={headingId}>Título</Label>
          <Input
            id={headingId}
            value={form.heading}
            maxLength={200}
            onChange={(event) => set('heading', event.target.value)}
          />
        </div>
        <div className='flex min-w-0 flex-col gap-1.5 md:col-span-2'>
          <Label htmlFor={bodyId}>Texto</Label>
          <Textarea
            id={bodyId}
            rows={4}
            value={form.body}
            maxLength={2000}
            onChange={(event) => set('body', event.target.value)}
          />
          <p className='text-muted-foreground text-xs'>
            Deixe uma linha em branco para separar parágrafos. O rodapé com
            descadastro e preferências é incluído automaticamente.
          </p>
        </div>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <Label htmlFor={buttonId}>Texto do botão</Label>
          <Input
            id={buttonId}
            value={form.buttonLabel}
            maxLength={60}
            onChange={(event) => set('buttonLabel', event.target.value)}
          />
        </div>
      </div>

      <div className='flex flex-wrap items-center justify-end gap-2'>
        {problem ? (
          <p className='mr-auto text-destructive text-xs'>{problem}</p>
        ) : null}
        <Button
          type='button'
          variant='outline'
          disabled={!dirty || save.isPending}
          onClick={() => setForm(formOf(saved))}
        >
          Descartar
        </Button>
        <Button
          type='submit'
          disabled={
            (!dirty && saved.saved) || !parsed?.success || save.isPending
          }
        >
          Salvar reengajamento
        </Button>
      </div>
    </form>
  )
}
