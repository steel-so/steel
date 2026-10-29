'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { useSurveyList } from '@/src/hooks/use-satisfaction-surveys'
import {
  CHANNEL_LABEL,
  formatSurveyDate,
  STATUS_LABEL,
  TRIGGER_LABEL,
} from './survey-labels'

/** Every invitation with its status, score and comment (newest first). */
export function WhatsappSurveyResponses({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [page, setPage] = useState(1)
  const list = useSurveyList(workspaceId, { page })

  if (list.isLoading) return <Skeleton className='m-6 h-64' />
  if (list.isError) {
    return <p className='p-6 text-sm text-destructive'>{list.error.message}</p>
  }
  const data = list.data
  if (!data || data.items.length === 0) {
    return (
      <p className='m-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
        Nenhuma pesquisa enviada ainda.
      </p>
    )
  }
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div className='space-y-4 p-6'>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Canal</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className='text-right'>Nota</TableHead>
              <TableHead>Comentário</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className='font-medium'>
                  {item.customerName ?? item.recipientName ?? '—'}
                  {item.assigneeName ? (
                    <span className='block text-xs font-normal text-muted-foreground'>
                      {item.assigneeName}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {TRIGGER_LABEL[item.trigger]} · {item.kind}
                </TableCell>
                <TableCell>{CHANNEL_LABEL[item.channel]}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      item.status === 'FAILED' ? 'destructive' : 'secondary'
                    }
                  >
                    {STATUS_LABEL[item.status]}
                  </Badge>
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {item.score ?? '—'}
                </TableCell>
                <TableCell
                  className='max-w-xs truncate'
                  title={item.comment ?? ''}
                >
                  {item.comment ?? '—'}
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {formatSurveyDate(
                    item.answeredAt ?? item.sentAt ?? item.createdAt,
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className='flex items-center justify-between text-sm text-muted-foreground'>
        <span>
          Página {page} de {pages}
        </span>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  )
}
