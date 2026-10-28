'use client'

import {
  Add01Icon,
  Alert02Icon,
  Analytics01Icon,
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  useCrmNewsletterIssues,
  useDeleteCrmNewsletterIssue,
} from '@/src/hooks/use-crm-newsletter-issues'
import type { CrmNewsletterIssueDTO } from '@/src/schemas/crm-newsletter-issue.schema'
import {
  formatCount,
  formatIssueDateTime,
  formatRate,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUS_VARIANT,
  issueEditorHref,
  issueReportHref,
} from './issue-format'
import { NewIssueDialog } from './new-issue-dialog'
import { NewsletterIssuesTrend } from './newsletter-issues-trend'

/**
 * "Edições" tab of a newsletter (ADR 0054). The nl-core slice mounts it in
 * the newsletter page; this slice owns the body: issues table (status,
 * number, sent date, open/click rates), "Nova edição", the trend of the
 * last issues and links to the editor and the report.
 */
export type NewsletterIssuesTabProps = {
  workspaceId: string
  workspaceSlug: string
  newsletterId: string
  /** False while the From domain is not verified: sending is blocked. */
  senderVerified: boolean
}

function IssueRow({
  issue,
  workspaceSlug,
  newsletterId,
  onDuplicate,
  onDelete,
}: {
  issue: CrmNewsletterIssueDTO
  workspaceSlug: string
  newsletterId: string
  onDuplicate: (issue: CrmNewsletterIssueDTO) => void
  onDelete: (issue: CrmNewsletterIssueDTO) => void
}) {
  const editable = issue.status === 'DRAFT' || issue.status === 'SCHEDULED'
  const editorHref = issueEditorHref(workspaceSlug, newsletterId, issue.id)
  const reportHref = issueReportHref(workspaceSlug, newsletterId, issue.id)
  const primaryHref = editable ? editorHref : reportHref
  const stats = issue.stats
  const when =
    issue.status === 'SCHEDULED'
      ? `Agendada para ${formatIssueDateTime(issue.scheduledAt)}`
      : formatIssueDateTime(issue.sentAt ?? issue.sendingStartedAt)

  return (
    <TableRow>
      <TableCell className='w-14 text-muted-foreground tabular-nums'>
        {issue.number ? `#${issue.number}` : '—'}
      </TableCell>
      <TableCell className='min-w-0 max-w-80'>
        <Link
          href={primaryHref}
          className='block truncate font-medium hover:underline'
        >
          {issue.subject}
        </Link>
        <span className='block truncate text-muted-foreground text-xs'>
          /{issue.slug}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={ISSUE_STATUS_VARIANT[issue.status]}>
          {ISSUE_STATUS_LABEL[issue.status]}
        </Badge>
      </TableCell>
      <TableCell className='whitespace-nowrap text-muted-foreground text-sm'>
        {issue.status === 'DRAFT' ? '—' : when}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {stats ? formatCount(stats.sent) : '—'}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {stats ? formatRate(stats.opened, stats.sent) : '—'}
      </TableCell>
      <TableCell className='text-right tabular-nums'>
        {stats ? formatRate(stats.clicked, stats.sent) : '—'}
      </TableCell>
      <TableCell className='w-10'>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Ações da edição ${issue.subject}`}
            className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
          >
            <SteelIcon icon={MoreHorizontalIcon} className='size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-52'>
            {editable ? (
              <DropdownMenuItem render={<Link href={editorHref} />}>
                <SteelIcon icon={PencilEdit02Icon} />
                Abrir editor
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem render={<Link href={reportHref} />}>
                <SteelIcon icon={Analytics01Icon} />
                Relatório
              </DropdownMenuItem>
            )}
            {issue.webUrl ? (
              <DropdownMenuItem
                render={
                  <a href={issue.webUrl} target='_blank' rel='noreferrer' />
                }
              >
                <SteelIcon icon={ViewIcon} />
                Versão web
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => onDuplicate(issue)}>
              <SteelIcon icon={Copy01Icon} />
              Duplicar
            </DropdownMenuItem>
            {issue.status === 'DRAFT' ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  onClick={() => onDelete(issue)}
                >
                  <SteelIcon icon={Delete02Icon} />
                  Excluir rascunho
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

export function NewsletterIssuesTab({
  workspaceId,
  workspaceSlug,
  newsletterId,
  senderVerified,
}: NewsletterIssuesTabProps) {
  const [page, setPage] = useState(1)
  const issues = useCrmNewsletterIssues(workspaceId, newsletterId, page)
  const remove = useDeleteCrmNewsletterIssue(workspaceId, newsletterId)
  const [creating, setCreating] = useState<{
    duplicateOf?: CrmNewsletterIssueDTO
  } | null>(null)

  function handleDelete(issue: CrmNewsletterIssueDTO) {
    remove.mutate(issue.id, {
      onSuccess: () => notify.success('Rascunho excluído'),
      onError: (error) => notify.error(error),
    })
  }

  const data = issues.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className='flex min-w-0 flex-col gap-4'>
      {!senderVerified ? (
        <Alert>
          <SteelIcon icon={Alert02Icon} />
          <AlertTitle>O remetente ainda não está verificado</AlertTitle>
          <AlertDescription>
            Você já pode escrever e testar edições, mas o envio para os
            assinantes fica bloqueado até o domínio do remetente estar
            verificado.{' '}
            <Link
              href={`/${workspaceSlug}/settings/email-domains`}
              className='underline underline-offset-2'
            >
              Ver domínios de e-mail
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <NewsletterIssuesTrend
        workspaceId={workspaceId}
        newsletterId={newsletterId}
      />

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 className='font-medium text-base'>Edições</h2>
          <p className='text-muted-foreground text-sm'>
            Cada edição é numerada quando o envio começa.
          </p>
        </div>
        <Button onClick={() => setCreating({})} data-testid='new-issue'>
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
          Nova edição
        </Button>
      </div>

      <div className='overflow-x-auto rounded-xl border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-14'>Nº</TableHead>
              <TableHead>Assunto</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Envio</TableHead>
              <TableHead className='text-right'>Enviados</TableHead>
              <TableHead className='text-right'>Abertura</TableHead>
              <TableHead className='text-right'>Clique</TableHead>
              <TableHead className='w-10'>
                <span className='sr-only'>Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.isLoading ? (
              [0, 1, 2].map((row) => (
                <TableRow key={row}>
                  <TableCell colSpan={8}>
                    <Skeleton className='h-6 w-full' />
                  </TableCell>
                </TableRow>
              ))
            ) : issues.isError ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className='py-8 text-center text-destructive text-sm'
                >
                  Não foi possível carregar as edições.{' '}
                  <button
                    type='button'
                    className='underline'
                    onClick={() => void issues.refetch()}
                  >
                    Tentar de novo
                  </button>
                </TableCell>
              </TableRow>
            ) : data && data.items.length > 0 ? (
              data.items.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  workspaceSlug={workspaceSlug}
                  newsletterId={newsletterId}
                  onDuplicate={(source) => setCreating({ duplicateOf: source })}
                  onDelete={handleDelete}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className='py-10 text-center text-muted-foreground text-sm'
                >
                  Nenhuma edição ainda. Crie a primeira com “Nova edição”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pages > 1 ? (
        <div className='flex items-center justify-end gap-2 text-sm'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </Button>
          <span className='text-muted-foreground tabular-nums'>
            {page} de {pages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      ) : null}

      <NewIssueDialog
        open={creating !== null}
        onOpenChange={(open) => {
          if (!open) setCreating(null)
        }}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        newsletterId={newsletterId}
        duplicateOf={creating?.duplicateOf ?? null}
      />
    </div>
  )
}
