'use client'

import {
  Delete02Icon,
  FileEditIcon,
  RssIcon,
  SparklesIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  formatIssueDate,
  formatIssueDateTime,
} from '@/app/_components/crm/newsletters/issues/issue-format'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
  useCrmNewsletterDigest,
  useDeleteCrmNewsletterDigest,
  usePreviewCrmNewsletterDigest,
  useRunCrmNewsletterDigest,
  useSaveCrmNewsletterDigest,
} from '@/src/hooks/use-crm-newsletter-digest-ai'
import {
  CRM_NEWSLETTER_DIGEST_MAX_ITEMS,
  type CrmNewsletterDigestPreviewDTO,
  UpsertCrmNewsletterDigestSchema,
} from '@/src/schemas/crm-newsletter-digest.schema'
import {
  cadenceSummary,
  type DigestForm,
  digestFormOf,
  digestPayloadOf,
  NO_SITE,
  OUTCOME_LABEL,
  WEEKDAY_LABELS,
} from './digest-form'

const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour))
const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => String(index + 1))
const MAX_ITEMS = Array.from(
  { length: CRM_NEWSLETTER_DIGEST_MAX_ITEMS },
  (_, index) => String(index + 1),
)

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

function PreviewList({ preview }: { preview: CrmNewsletterDigestPreviewDTO }) {
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {preview.warnings.map((warning) => (
        <p key={warning} className='text-destructive text-xs' role='alert'>
          {warning}
        </p>
      ))}
      {preview.items.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhum post novo desde {formatIssueDate(preview.since)}. O próximo
          resumo será pulado se continuar assim.
        </p>
      ) : (
        <ul className='flex min-w-0 flex-col divide-y rounded-lg border'>
          {preview.items.map((item) => (
            <li key={item.url} className='flex min-w-0 gap-3 p-3'>
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt=''
                  className='size-12 shrink-0 rounded-md object-cover'
                  loading='lazy'
                />
              ) : null}
              <div className='min-w-0'>
                <a
                  href={item.url}
                  target='_blank'
                  rel='noreferrer'
                  className='line-clamp-1 font-medium text-sm hover:underline'
                >
                  {item.title}
                </a>
                <p className='line-clamp-2 text-muted-foreground text-xs'>
                  {item.excerpt}
                </p>
                <p className='text-[11px] text-muted-foreground'>
                  {item.source === 'SITE' ? 'Blog do site' : 'Feed RSS'} ·{' '}
                  {formatIssueDate(item.publishedAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * "Resumo automático" tab of a newsletter (nl2-digest-ai): sources (Site
 * blog and/or RSS), cadence in São Paulo time, draft or automatic send,
 * preview of the next digest and "Gerar rascunho agora".
 */
export function NewsletterDigestTab({
  workspaceId,
  workspaceSlug,
  newsletterId,
  archived,
}: {
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  archived: boolean
}) {
  const settings = useCrmNewsletterDigest(workspaceId, newsletterId)
  const save = useSaveCrmNewsletterDigest(workspaceId, newsletterId)
  const remove = useDeleteCrmNewsletterDigest(workspaceId, newsletterId)
  const preview = usePreviewCrmNewsletterDigest(workspaceId, newsletterId)
  const run = useRunCrmNewsletterDigest(workspaceId, newsletterId)
  const [form, setForm] = useState<DigestForm>(() => digestFormOf(null))
  const [loaded, setLoaded] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const digest = settings.data?.digest ?? null
  useEffect(() => {
    if (!settings.data || loaded) return
    setForm(digestFormOf(settings.data.digest))
    setLoaded(true)
  }, [settings.data, loaded])

  function set<K extends keyof DigestForm>(key: K, value: DigestForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  if (settings.isLoading || !loaded) {
    return (
      <div className='flex flex-col gap-4'>
        <Skeleton className='h-40 w-full' />
        <Skeleton className='h-40 w-full' />
      </div>
    )
  }

  const sites = settings.data?.sites ?? []
  const payload = digestPayloadOf(form)
  const parsed = UpsertCrmNewsletterDigestSchema.safeParse(payload)
  const firstIssue = parsed.success ? null : parsed.error.issues[0]?.message

  function handleSave(event: React.FormEvent) {
    event.preventDefault()
    if (!parsed.success) {
      notify.error(firstIssue ?? 'Confira os campos')
      return
    }
    save.mutate(parsed.data, {
      onSuccess: (data) => {
        setForm(digestFormOf(data.digest))
        notify.success(
          data.digest?.enabled
            ? 'Resumo automático salvo'
            : 'Resumo automático salvo (desligado)',
        )
      },
      onError: (error) => notify.error(error, 'Erro ao salvar'),
    })
  }

  function handlePreview() {
    preview.mutate(
      {
        siteId: payload.siteId,
        rssUrl: payload.rssUrl,
        maxItems: payload.maxItems,
      },
      { onError: (error) => notify.error(error) },
    )
  }

  function handleRun() {
    run.mutate(undefined, {
      onSuccess: (result) => {
        if (result.issueId) notify.success(result.message)
        else notify.info(result.message)
      },
      onError: (error) => notify.error(error),
    })
  }

  function handleRemove() {
    remove.mutate(undefined, {
      onSuccess: () => {
        setForm(digestFormOf(null))
        setConfirmRemove(false)
        notify.success('Resumo automático removido')
      },
      onError: (error) => notify.error(error, 'Erro ao remover'),
    })
  }

  const sourceMissing = payload.siteId === null && payload.rssUrl === null

  return (
    <div className='flex min-w-0 flex-col gap-6'>
      {digest ? (
        <section className='flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <p className='font-medium text-sm'>
                {digest.enabled ? 'Resumo ligado' : 'Resumo desligado'}
              </p>
              {digest.lastOutcome ? (
                <Badge
                  variant={
                    digest.lastOutcome === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {OUTCOME_LABEL[digest.lastOutcome]}
                </Badge>
              ) : null}
            </div>
            <p className='text-muted-foreground text-xs'>
              {digest.enabled && digest.nextRunAt
                ? `Próximo resumo: ${formatIssueDateTime(digest.nextRunAt)}`
                : 'Nenhum resumo agendado.'}
              {digest.lastRunAt
                ? ` · Último: ${formatIssueDateTime(digest.lastRunAt)}`
                : ''}
            </p>
            {digest.lastMessage ? (
              <p className='text-muted-foreground text-xs'>
                {digest.lastMessage}
              </p>
            ) : null}
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            {digest.lastIssueId ? (
              <Button
                variant='outline'
                size='sm'
                render={
                  <Link
                    href={`/${workspaceSlug}/crm/newsletters/${newsletterId}/issues/${digest.lastIssueId}`}
                  />
                }
              >
                <SteelIcon icon={FileEditIcon} />
                Abrir última edição
              </Button>
            ) : null}
            <Button
              size='sm'
              variant='outline'
              onClick={handleRun}
              disabled={run.isPending || archived}
            >
              <SteelIcon icon={SparklesIcon} />
              {run.isPending ? 'Gerando…' : 'Gerar rascunho agora'}
            </Button>
          </div>
        </section>
      ) : null}

      <form onSubmit={handleSave} className='flex min-w-0 flex-col gap-6'>
        <section className='flex flex-col gap-4 rounded-xl border p-4'>
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0'>
              <h2 className='font-medium'>Resumo automático</h2>
              <p className='text-muted-foreground text-xs'>
                Junta os posts novos do seu blog ou de um feed RSS numa edição,
                toda semana ou todo mês. Só entram posts publicados depois do
                último resumo.
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(checked) => set('enabled', checked)}
              aria-label='Resumo automático ligado'
            />
          </div>
          <div className='grid gap-4 md:grid-cols-2'>
            <Field
              id='digest-site'
              label='Blog do Sites'
              hint={
                sites.length === 0
                  ? 'Nenhum site neste workspace.'
                  : 'Posts publicados do blog do site.'
              }
            >
              <Select
                value={form.siteId}
                onValueChange={(value) => set('siteId', String(value))}
              >
                <SelectTrigger id='digest-site' className='w-full'>
                  <SelectValue>
                    {(value: string) =>
                      value === NO_SITE
                        ? 'Nenhum'
                        : (sites.find((site) => site.id === value)?.name ??
                          digest?.siteName ??
                          'Site removido')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SITE}>Nenhum</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                      {site.published ? '' : ' (não publicado)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id='digest-rss'
              label='Feed RSS ou Atom (opcional)'
              hint='Endereço https:// público. Posts sem data são ignorados.'
            >
              <div className='relative'>
                <SteelIcon
                  icon={RssIcon}
                  className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
                />
                <Input
                  id='digest-rss'
                  type='url'
                  inputMode='url'
                  value={form.rssUrl}
                  maxLength={2000}
                  placeholder='https://blog.empresa.com.br/feed'
                  className='pl-8'
                  onChange={(event) => set('rssUrl', event.target.value)}
                />
              </div>
            </Field>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handlePreview}
              disabled={sourceMissing || preview.isPending}
            >
              {preview.isPending
                ? 'Lendo as fontes…'
                : 'Ver posts do próximo resumo'}
            </Button>
            {sourceMissing ? (
              <p className='text-muted-foreground text-xs'>
                Escolha um blog, um feed ou os dois.
              </p>
            ) : null}
          </div>
          {preview.data ? <PreviewList preview={preview.data} /> : null}
        </section>

        <section className='grid gap-4 rounded-xl border p-4 md:grid-cols-2 xl:grid-cols-4'>
          <h2 className='font-medium md:col-span-2 xl:col-span-4'>Quando</h2>
          <Field id='digest-cadence' label='Frequência'>
            <Select
              value={form.cadence}
              onValueChange={(value) =>
                set('cadence', value === 'MONTHLY' ? 'MONTHLY' : 'WEEKLY')
              }
            >
              <SelectTrigger id='digest-cadence' className='w-full'>
                <SelectValue>
                  {(value: string) =>
                    value === 'MONTHLY' ? 'Mensal' : 'Semanal'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='WEEKLY'>Semanal</SelectItem>
                <SelectItem value='MONTHLY'>Mensal</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {form.cadence === 'WEEKLY' ? (
            <Field id='digest-weekday' label='Dia da semana'>
              <Select
                value={form.weekday}
                onValueChange={(value) => set('weekday', String(value))}
              >
                <SelectTrigger id='digest-weekday' className='w-full'>
                  <SelectValue>
                    {(value: string) => WEEKDAY_LABELS[Number(value)]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <SelectItem key={label} value={String(index)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field id='digest-month-day' label='Dia do mês'>
              <Select
                value={form.monthDay}
                onValueChange={(value) => set('monthDay', String(value))}
              >
                <SelectTrigger id='digest-month-day' className='w-full'>
                  <SelectValue>{(value: string) => `Dia ${value}`}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MONTH_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      Dia {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field id='digest-hour' label='Horário (Brasília)'>
            <Select
              value={form.hour}
              onValueChange={(value) => set('hour', String(value))}
            >
              <SelectTrigger id='digest-hour' className='w-full'>
                <SelectValue>
                  {(value: string) => `${value.padStart(2, '0')}:00`}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((hour) => (
                  <SelectItem key={hour} value={hour}>
                    {hour.padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id='digest-max' label='Máximo de posts'>
            <Select
              value={form.maxItems}
              onValueChange={(value) => set('maxItems', String(value))}
            >
              <SelectTrigger id='digest-max' className='w-full'>
                <SelectValue>{(value: string) => value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MAX_ITEMS.map((count) => (
                  <SelectItem key={count} value={count}>
                    {count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className='text-muted-foreground text-xs md:col-span-2 xl:col-span-4'>
            {cadenceSummary(form)}.
          </p>
        </section>

        <section className='flex flex-col gap-4 rounded-xl border p-4'>
          <h2 className='font-medium'>O que acontece</h2>
          <RadioGroup
            value={form.mode}
            onValueChange={(value) =>
              set('mode', value === 'AUTO_SEND' ? 'AUTO_SEND' : 'DRAFT')
            }
            className='grid gap-3 md:grid-cols-2'
          >
            <Label className='flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-checked]]:border-primary'>
              <RadioGroupItem value='DRAFT' className='mt-0.5' />
              <span className='min-w-0'>
                <span className='block font-medium text-sm'>
                  Criar rascunho
                </span>
                <span className='block text-muted-foreground text-xs'>
                  A edição fica em rascunho e você recebe um aviso para revisar
                  e enviar.
                </span>
              </span>
            </Label>
            <Label className='flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-checked]]:border-primary'>
              <RadioGroupItem value='AUTO_SEND' className='mt-0.5' />
              <span className='min-w-0'>
                <span className='block font-medium text-sm'>
                  Enviar automaticamente
                </span>
                <span className='block text-muted-foreground text-xs'>
                  Envia sozinho quando há posts novos e o envio passa nas
                  conferências (remetente, limite do mês). Senão, fica o
                  rascunho e você é avisado.
                </span>
              </span>
            </Label>
          </RadioGroup>
          <Field
            id='digest-subject'
            label='Assunto'
            hint='Use {data} para a data do resumo. Ex.: Resumo de {data}'
          >
            <Input
              id='digest-subject'
              value={form.subject}
              maxLength={200}
              onChange={(event) => set('subject', event.target.value)}
            />
          </Field>
          <Field
            id='digest-intro'
            label='Texto de abertura (opcional)'
            hint='Aparece antes da lista de posts.'
          >
            <Textarea
              id='digest-intro'
              value={form.intro}
              maxLength={2000}
              rows={3}
              placeholder='Os destaques do nosso blog nesta semana.'
              onChange={(event) => set('intro', event.target.value)}
            />
          </Field>
        </section>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          {digest ? (
            <Button
              type='button'
              variant='ghost'
              className='text-destructive'
              onClick={() => setConfirmRemove(true)}
            >
              <SteelIcon icon={Delete02Icon} />
              Remover resumo
            </Button>
          ) : (
            <span />
          )}
          <div className='flex items-center gap-2'>
            {firstIssue ? (
              <p className='text-destructive text-xs' role='alert'>
                {firstIssue}
              </p>
            ) : null}
            <Button type='submit' disabled={save.isPending || !parsed.success}>
              {save.isPending ? 'Salvando…' : 'Salvar resumo'}
            </Button>
          </div>
        </div>
      </form>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o resumo automático?</AlertDialogTitle>
            <AlertDialogDescription>
              Os próximos resumos deixam de ser criados. As edições que ele já
              criou continuam na aba Edições.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={remove.isPending}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
