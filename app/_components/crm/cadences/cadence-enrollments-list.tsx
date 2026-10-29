'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import {
  useActCrmCadenceEnrollment,
  useCrmCadenceEnrollments,
} from '@/src/hooks/use-crm-cadences'
import type {
  CrmCadenceEnrollmentDTO,
  CrmCadenceEnrollmentStatusDTO,
} from '@/types/crm-cadence'
import {
  ENROLLMENT_STATUS_LABEL,
  formatCadenceDate,
  RUN_STATUS_LABEL,
  STEP_TYPE_LABEL,
  STOP_REASON_LABEL,
} from './cadence-labels'

const STATUS_VARIANT: Record<
  CrmCadenceEnrollmentStatusDTO,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'secondary',
  PAUSED: 'outline',
  REPLIED: 'default',
  COMPLETED: 'outline',
  STOPPED: 'destructive',
}

/** Enrollments of a cadence (or of one lead), with the stop/pause/resume actions. */
export function CadenceEnrollmentsList({
  workspaceId,
  cadenceId,
  leadId,
  showCadenceName = false,
  emptyText = 'Ninguém foi inscrito ainda.',
}: {
  workspaceId: string
  cadenceId?: string
  leadId?: string
  showCadenceName?: boolean
  emptyText?: string
}) {
  const enrollments = useCrmCadenceEnrollments(workspaceId, {
    cadenceId,
    leadId,
  })
  const act = useActCrmCadenceEnrollment(workspaceId)
  const [openId, setOpenId] = useState<string | null>(null)

  if (enrollments.isLoading) return <Skeleton className='h-16 w-full' />
  if (enrollments.isError) {
    return (
      <p className='text-destructive text-sm'>
        Não foi possível carregar as inscrições.
      </p>
    )
  }
  const rows = enrollments.data ?? []
  if (rows.length === 0) {
    return <p className='text-muted-foreground text-sm'>{emptyText}</p>
  }

  const run = (
    row: CrmCadenceEnrollmentDTO,
    action: 'stop' | 'pause' | 'resume' | 'replied',
    done: string,
  ) =>
    act.mutate(
      { enrollmentId: row.id, action },
      {
        onSuccess: () => notify.success(done),
        onError: (error) => notify.error(error),
      },
    )

  return (
    <ul className='flex flex-col divide-y rounded-lg border'>
      {rows.map((row) => {
        const open = row.status === 'ACTIVE' || row.status === 'PAUSED'
        return (
          <li key={row.id} className='flex flex-col gap-2 p-3 text-sm'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='font-medium'>
                {showCadenceName ? row.cadenceName : row.leadName}
              </span>
              <Badge variant={STATUS_VARIANT[row.status]}>
                {ENROLLMENT_STATUS_LABEL[row.status]}
              </Badge>
              <span className='text-muted-foreground text-xs'>
                {row.status === 'ACTIVE' && row.nextRunAt
                  ? `Passo ${row.nextPosition + 1} de ${row.totalSteps ?? '?'} em ${formatCadenceDate(row.nextRunAt)}`
                  : row.stopReason
                    ? STOP_REASON_LABEL[row.stopReason]
                    : `Passo ${Math.min(row.nextPosition + 1, row.totalSteps ?? row.nextPosition + 1)} de ${row.totalSteps ?? '?'}`}
              </span>
              <div className='ml-auto flex flex-wrap gap-1'>
                {row.status === 'ACTIVE' ? (
                  <Button
                    size='xs'
                    variant='outline'
                    disabled={act.isPending}
                    onClick={() => run(row, 'pause', 'Inscrição pausada')}
                  >
                    Pausar
                  </Button>
                ) : null}
                {row.status === 'PAUSED' ? (
                  <Button
                    size='xs'
                    variant='outline'
                    disabled={act.isPending}
                    onClick={() => run(row, 'resume', 'Inscrição retomada')}
                  >
                    Retomar
                  </Button>
                ) : null}
                {open ? (
                  <>
                    <Button
                      size='xs'
                      variant='outline'
                      disabled={act.isPending}
                      onClick={() =>
                        run(row, 'replied', 'Marcado como respondeu')
                      }
                    >
                      Respondeu
                    </Button>
                    <Button
                      size='xs'
                      variant='ghost'
                      disabled={act.isPending}
                      onClick={() => run(row, 'stop', 'Inscrição encerrada')}
                    >
                      Parar
                    </Button>
                  </>
                ) : null}
                {row.runs.length > 0 ? (
                  <Button
                    size='xs'
                    variant='ghost'
                    aria-expanded={openId === row.id}
                    onClick={() => setOpenId(openId === row.id ? null : row.id)}
                  >
                    Histórico
                  </Button>
                ) : null}
              </div>
            </div>
            {openId === row.id ? (
              <ul className='flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-xs'>
                {row.runs.map((item) => (
                  <li key={item.id} className='flex flex-wrap gap-x-2'>
                    <span className='text-muted-foreground'>
                      {formatCadenceDate(item.createdAt)}
                    </span>
                    <span>
                      Passo {item.position + 1} · {STEP_TYPE_LABEL[item.type]}
                    </span>
                    <span
                      className={
                        item.status === 'FAILED'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {RUN_STATUS_LABEL[item.status]}
                      {item.detail ? ` — ${item.detail}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
