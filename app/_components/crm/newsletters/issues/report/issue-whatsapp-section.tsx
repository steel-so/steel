'use client'

import Link from 'next/link'
import { useState } from 'react'
import { OptionSelect } from '@/app/_components/crm/email-editor/option-select'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type CrmNewsletterDeliveryStatusValue,
  useCrmNewsletterWhatsAppReport,
  type WhatsAppReportQuery,
} from '@/src/hooks/use-crm-newsletter-engage'
import { CRM_NEWSLETTER_DELIVERY_STATUSES } from '@/src/schemas/crm-newsletter-issue.schema'
import {
  DELIVERY_STATUS_LABEL,
  formatCount,
  formatIssueDateTime,
} from '../issue-format'
import { personHref } from './issue-polls-section'

export const WA_SKIP_REASON_LABEL: Record<string, string> = {
  OPTED_OUT: 'Pediu para sair das transmissões',
  LIMIT_REACHED: 'Limite mensal da Comunicação atingido',
  UNAVAILABLE: 'WhatsApp indisponível no envio',
  STOPPED: 'Envio interrompido',
}

const ALL = 'all'

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className='flex min-w-0 flex-col rounded-xl border p-3'>
      <span className='truncate text-muted-foreground text-xs'>{label}</span>
      <span className='font-semibold text-xl tabular-nums'>
        {formatCount(value)}
      </span>
    </div>
  )
}

/**
 * "WhatsApp" of the issue report (nl2-engage): totals and the status of
 * each number. Renders nothing when the issue had no WhatsApp version.
 */
export function IssueWhatsAppSection({
  workspaceId,
  slug,
  newsletterId,
  issueId,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  issueId: string
}) {
  const [query, setQuery] = useState<WhatsAppReportQuery>({
    page: 1,
    status: null,
  })
  const report = useCrmNewsletterWhatsAppReport(
    workspaceId,
    newsletterId,
    issueId,
    query,
  )
  const data = report.data
  if (report.isLoading) return <Skeleton className='h-32 w-full' />
  if (!data || (!data.enabled && data.stats.total === 0)) return null
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <section
      aria-label='WhatsApp'
      className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='font-medium text-sm'>
          WhatsApp{' '}
          <span className='text-muted-foreground'>
            {data.provider === 'META'
              ? '(template da Meta)'
              : data.provider === 'ZAPI'
                ? '(Z-API)'
                : ''}
          </span>
        </h2>
        <OptionSelect
          label='Filtrar números'
          className='w-44'
          value={query.status ?? ALL}
          onChange={(value) =>
            setQuery({
              page: 1,
              status:
                value === ALL
                  ? null
                  : (value as CrmNewsletterDeliveryStatusValue),
            })
          }
          options={[
            { value: ALL, label: 'Todos' },
            ...CRM_NEWSLETTER_DELIVERY_STATUSES.filter(
              (status) => status !== 'SENDING',
            ).map((status) => ({
              value: status,
              label: DELIVERY_STATUS_LABEL[status],
            })),
          ]}
        />
      </div>
      {data.stats.total === 0 ? (
        <p className='text-muted-foreground text-sm'>
          O WhatsApp sai quando o envio por e-mail terminar, para os assinantes
          ligados a uma pessoa do CRM com telefone de WhatsApp.
        </p>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
            <Tile label='Enviados' value={data.stats.sent} />
            <Tile label='Na fila' value={data.stats.pending} />
            <Tile label='Falharam' value={data.stats.failed} />
            <Tile label='Não enviados' value={data.stats.skipped} />
          </div>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contato</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Enviado em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className='py-6 text-center text-muted-foreground text-sm'
                    >
                      Ninguém nesta situação.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className='max-w-64'>
                        {row.personId ? (
                          <Link
                            href={personHref(slug, row.personId)}
                            className='block truncate font-medium hover:underline'
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className='block truncate'>{row.name}</span>
                        )}
                        <span className='block truncate text-muted-foreground text-xs tabular-nums'>
                          {row.phone}
                        </span>
                      </TableCell>
                      <TableCell className='text-sm'>
                        {row.status === 'SKIPPED' && row.skipReason
                          ? (WA_SKIP_REASON_LABEL[row.skipReason] ??
                            DELIVERY_STATUS_LABEL.SKIPPED)
                          : DELIVERY_STATUS_LABEL[row.status]}
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
                        {formatIssueDateTime(row.sentAt)}
                      </TableCell>
                    </TableRow>
                  ))
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
                  setQuery((current) => ({
                    ...current,
                    page: current.page - 1,
                  }))
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
                  setQuery((current) => ({
                    ...current,
                    page: current.page + 1,
                  }))
                }
              >
                Próxima
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
