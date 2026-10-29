'use client'

import {
  ArrowLeft01Icon,
  InformationCircleIcon,
  Search01Icon,
  StopCircleIcon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { OptionSelect } from '@/app/_components/crm/email-editor/option-select'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { notify } from '@/lib/notify'
import {
  LIVE_ISSUE_STATUSES,
  type RecipientsQuery,
  useCrmNewsletterIssue,
  useCrmNewsletterIssueAction,
  useCrmNewsletterIssueRecipients,
  useCrmNewsletterIssueReport,
} from '@/src/hooks/use-crm-newsletter-issues'
import {
  CRM_NEWSLETTER_RECIPIENT_FILTERS,
  type CrmNewsletterIssueLinkStatDTO,
  type CrmNewsletterIssueStatsDTO,
  type CrmNewsletterRecipientFilter,
} from '@/src/schemas/crm-newsletter-issue.schema'
import {
  DELIVERY_STATUS_LABEL,
  formatCount,
  formatIssueDateTime,
  formatRate,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUS_VARIANT,
  newsletterHref,
  RECIPIENT_FILTER_LABEL,
  SKIP_REASON_LABEL,
} from '../issue-format'
import { IssueAbTestCard } from './issue-ab-test-card'
import { IssuePollsSection } from './issue-polls-section'
import { IssueWhatsAppSection } from './issue-whatsapp-section'

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className='flex min-w-0 flex-col rounded-xl border p-3'>
      <span className='truncate text-muted-foreground text-xs'>{label}</span>
      <span className='font-semibold text-xl tabular-nums'>{value}</span>
      {hint ? (
        <span className='truncate text-muted-foreground text-xs'>{hint}</span>
      ) : null}
    </div>
  )
}

/** Sent → delivered → opened → clicked, relative to the e-mails sent. */
export function IssueFunnel({ stats }: { stats: CrmNewsletterIssueStatsDTO }) {
  const steps = [
    { label: 'Enviados', value: stats.sent },
    { label: 'Entregues', value: stats.delivered },
    { label: 'Abriram', value: stats.opened },
    { label: 'Clicaram', value: stats.clicked },
  ]
  const top = stats.sent
  return (
    <section
      aria-label='Funil da edição'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <h2 className='font-medium text-sm'>Funil</h2>
      <ul className='flex flex-col gap-2'>
        {steps.map((step) => (
          <li key={step.label} className='flex flex-col gap-1'>
            <div className='flex items-baseline justify-between gap-2 text-sm'>
              <span>{step.label}</span>
              <span className='tabular-nums'>
                <strong>{formatCount(step.value)}</strong>{' '}
                <span className='text-muted-foreground text-xs'>
                  {formatRate(step.value, top)}
                </span>
              </span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className='h-full rounded-full bg-primary'
                style={{
                  width: top > 0 ? `${(step.value / top) * 100}%` : '0%',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground text-xs'>
        {formatCount(stats.skipped)} não enviados · {formatCount(stats.failed)}{' '}
        com falha · {formatCount(stats.bounced)} retornaram ·{' '}
        {formatCount(stats.complained)} marcaram como spam ·{' '}
        {formatCount(stats.unsubscribed)} saíram
      </p>
      <p className='flex items-start gap-1.5 text-muted-foreground text-xs'>
        <SteelIcon
          icon={InformationCircleIcon}
          className='mt-0.5 size-3.5 shrink-0'
        />
        A taxa de abertura é uma estimativa: o Apple Mail (proteção de
        privacidade) abre as imagens sozinho e conta como abertura. Os cliques
        são o sinal mais confiável de interesse.
      </p>
    </section>
  )
}

export function IssueLinksTable({
  links,
  sent,
}: {
  links: CrmNewsletterIssueLinkStatDTO[]
  sent: number
}) {
  return (
    <section
      aria-label='Cliques por link'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <h2 className='font-medium text-sm'>Cliques por link</h2>
      {links.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          Nenhum clique registrado ainda.
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Link</TableHead>
                <TableHead className='text-right'>Cliques</TableHead>
                <TableHead className='text-right'>Pessoas</TableHead>
                <TableHead className='text-right'>Taxa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.url}>
                  <TableCell className='max-w-96'>
                    <a
                      href={link.url}
                      target='_blank'
                      rel='noreferrer'
                      className='block truncate hover:underline'
                      title={link.url}
                    >
                      {link.url}
                    </a>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatCount(link.clicks)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatCount(link.uniqueClickers)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {formatRate(link.uniqueClickers, sent)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}

function RecipientsSection({
  workspaceId,
  newsletterId,
  issueId,
}: {
  workspaceId: string
  newsletterId: string
  issueId: string
}) {
  const [query, setQuery] = useState<RecipientsQuery>({
    page: 1,
    filter: 'all',
    search: '',
  })
  const recipients = useCrmNewsletterIssueRecipients(
    workspaceId,
    newsletterId,
    issueId,
    query,
  )
  const data = recipients.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <section
      aria-label='Destinatários'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>
          Destinatários{' '}
          {data ? (
            <span className='text-muted-foreground'>
              ({formatCount(data.total)})
            </span>
          ) : null}
        </h2>
        <div className='flex w-full flex-wrap gap-2 sm:w-auto'>
          <div className='relative min-w-0 flex-1 sm:w-56 sm:flex-none'>
            <SteelIcon
              icon={Search01Icon}
              className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground'
            />
            <Input
              aria-label='Buscar destinatário'
              placeholder='Buscar e-mail ou nome'
              className='h-8 pl-8'
              value={query.search}
              onChange={(event) =>
                setQuery((current) => ({
                  ...current,
                  page: 1,
                  search: event.target.value,
                }))
              }
            />
          </div>
          <OptionSelect
            label='Filtrar destinatários'
            className='w-44'
            value={query.filter}
            onChange={(value) =>
              setQuery((current) => ({
                ...current,
                page: 1,
                filter: value as CrmNewsletterRecipientFilter,
              }))
            }
            options={CRM_NEWSLETTER_RECIPIENT_FILTERS.map((filter) => ({
              value: filter,
              label: RECIPIENT_FILTER_LABEL[filter],
            }))}
          />
        </div>
      </div>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>E-mail</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Abriu</TableHead>
              <TableHead>Clicou</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!data ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className='h-6 w-full' />
                </TableCell>
              </TableRow>
            ) : data.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='py-6 text-center text-muted-foreground text-sm'
                >
                  Ninguém nesta situação.
                </TableCell>
              </TableRow>
            ) : (
              data.items.map((row) => {
                const problem = row.complainedAt
                  ? 'Marcou como spam'
                  : row.bouncedAt
                    ? 'Retornou'
                    : row.unsubscribedAt
                      ? 'Saiu da newsletter'
                      : null
                return (
                  <TableRow key={row.id}>
                    <TableCell className='max-w-72'>
                      <span className='block truncate'>{row.email}</span>
                      {row.name ? (
                        <span className='block truncate text-muted-foreground text-xs'>
                          {row.name}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-sm'>
                      {problem ??
                        (row.status === 'SKIPPED' && row.skipReason
                          ? (SKIP_REASON_LABEL[row.skipReason] ??
                            DELIVERY_STATUS_LABEL.SKIPPED)
                          : row.deliveredAt
                            ? 'Entregue'
                            : DELIVERY_STATUS_LABEL[row.status])}
                      {row.status === 'FAILED' && row.error ? (
                        <span
                          className='block max-w-64 truncate text-destructive text-xs'
                          title={row.error}
                        >
                          {row.error}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground text-sm'>
                      {formatIssueDateTime(row.openedAt)}
                    </TableCell>
                    <TableCell className='whitespace-nowrap text-muted-foreground text-sm'>
                      {formatIssueDateTime(row.clickedAt)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
      {pages > 1 ? (
        <div className='flex items-center justify-end gap-2 text-sm'>
          <Button
            variant='outline'
            size='sm'
            disabled={query.page <= 1}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page - 1 }))
            }
          >
            Anterior
          </Button>
          <span className='text-muted-foreground tabular-nums'>
            {query.page} de {pages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={query.page >= pages}
            onClick={() =>
              setQuery((current) => ({ ...current, page: current.page + 1 }))
            }
          >
            Próxima
          </Button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Report of one issue: funnel (sent → delivered → opened → clicked, with
 * the Apple Mail hint), clicks per link and the recipients with filters.
 * Polls while the issue is sending; "Parar envio" skips what is left.
 */
export function NewsletterIssueReport({
  workspaceId,
  slug,
  newsletterId,
  newsletterName,
  issueId,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  newsletterName: string
  issueId: string
}) {
  const issue = useCrmNewsletterIssue(workspaceId, newsletterId, issueId, {
    poll: true,
  })
  const live = issue.data
    ? LIVE_ISSUE_STATUSES.includes(issue.data.status)
    : false
  const report = useCrmNewsletterIssueReport(
    workspaceId,
    newsletterId,
    issueId,
    live,
  )
  const action = useCrmNewsletterIssueAction(workspaceId, newsletterId, issueId)
  const [confirmStop, setConfirmStop] = useState(false)

  if (issue.isError) {
    return (
      <p className='p-6 text-muted-foreground text-sm'>
        Não foi possível carregar a edição.
      </p>
    )
  }
  if (!issue.data) {
    return (
      <div className='flex flex-col gap-3 p-4 md:p-6' aria-busy='true'>
        <Skeleton className='h-10 w-2/3' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }
  const current = issue.data
  const stats = report.data?.stats

  function stop() {
    action.mutate(
      { action: 'stop' },
      {
        onSuccess: () => notify.success('Envio interrompido'),
        onError: (error) => notify.error(error),
      },
    )
  }

  return (
    <div className='mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-4 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <Link
            href={newsletterHref(slug, newsletterId)}
            className='inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground'
          >
            <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
            {newsletterName}
          </Link>
          <h1 className='mt-1 break-words font-semibold text-xl'>
            {current.number ? `#${current.number} · ` : ''}
            {current.subject}
          </h1>
          <div className='mt-1 flex flex-wrap items-center gap-2 text-muted-foreground text-sm'>
            <Badge variant={ISSUE_STATUS_VARIANT[current.status]}>
              {ISSUE_STATUS_LABEL[current.status]}
            </Badge>
            {current.sentAt ? (
              <span>Enviada em {formatIssueDateTime(current.sentAt)}</span>
            ) : current.sendingStartedAt ? (
              <span>
                Envio iniciado em{' '}
                {formatIssueDateTime(current.sendingStartedAt)}
              </span>
            ) : current.scheduledAt ? (
              <span>
                Agendada para {formatIssueDateTime(current.scheduledAt)}
              </span>
            ) : null}
          </div>
          {current.failureReason ? (
            <p className='mt-1 text-destructive text-sm'>
              {current.failureReason}
            </p>
          ) : null}
        </div>
        <div className='flex flex-wrap gap-2'>
          {current.webUrl ? (
            <a
              href={current.webUrl}
              target='_blank'
              rel='noreferrer'
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <SteelIcon icon={ViewIcon} />
              Versão web
            </a>
          ) : null}
          {current.status === 'SENDING' ? (
            <Button
              variant='destructive'
              size='sm'
              onClick={() => setConfirmStop(true)}
              disabled={action.isPending}
            >
              <SteelIcon icon={StopCircleIcon} />
              Parar envio
            </Button>
          ) : null}
        </div>
      </div>

      {!stats ? (
        <Skeleton className='h-24 w-full' />
      ) : (
        <>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <Tile
              label='Destinatários'
              value={formatCount(stats.recipients)}
              hint={`${formatCount(stats.sent)} enviados`}
            />
            <Tile
              label='Entrega'
              value={formatRate(stats.delivered, stats.sent)}
              hint={`${formatCount(stats.delivered)} entregues`}
            />
            <Tile
              label='Abertura'
              value={formatRate(stats.opened, stats.sent)}
              hint={`${formatCount(stats.opened)} pessoas`}
            />
            <Tile
              label='Clique'
              value={formatRate(stats.clicked, stats.sent)}
              hint={`${formatCount(stats.clicked)} pessoas`}
            />
          </div>
          <div className='grid min-w-0 gap-4 lg:grid-cols-2'>
            <IssueFunnel stats={stats} />
            <IssueLinksTable
              links={report.data?.links ?? []}
              sent={stats.sent}
            />
          </div>
        </>
      )}

      <IssueAbTestCard
        workspaceId={workspaceId}
        newsletterId={newsletterId}
        issueId={issueId}
        live={live}
      />
      {/* nl2-engage: poll results and the WhatsApp version. */}
      <IssuePollsSection
        workspaceId={workspaceId}
        slug={slug}
        newsletterId={newsletterId}
        issueId={issueId}
        live={live}
      />
      <IssueWhatsAppSection
        workspaceId={workspaceId}
        slug={slug}
        newsletterId={newsletterId}
        issueId={issueId}
      />

      <RecipientsSection
        workspaceId={workspaceId}
        newsletterId={newsletterId}
        issueId={issueId}
      />

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Parar o envio?</AlertDialogTitle>
            <AlertDialogDescription>
              Quem ainda não recebeu fica sem esta edição. Os e-mails que já
              saíram não podem ser recolhidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar enviando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmStop(false)
                stop()
              }}
            >
              Parar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
