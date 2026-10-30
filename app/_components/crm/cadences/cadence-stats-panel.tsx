'use client'

import { ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useCrmCadence } from '@/src/hooks/use-crm-cadences'
import type { CrmCadenceDTO, CrmCadenceStepStatsDTO } from '@/types/crm-cadence'
import { CadenceEnrollmentsList } from './cadence-enrollments-list'
import {
  CADENCE_STATUS_LABEL,
  describeDelay,
  formatPercent,
  formatShare,
  STEP_TYPE_LABEL,
} from './cadence-labels'

const NO_STEP: CrmCadenceStepStatsDTO = {
  position: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  opened: 0,
  clicked: 0,
  reached: 0,
}

/** Stats page of one cadence: totals, the funnel step by step, and who is in it. */
export function CadenceStatsPanel({
  workspaceId,
  slug,
  cadenceId,
}: {
  workspaceId: string
  slug: string
  cadenceId: string
}) {
  const cadence = useCrmCadence(workspaceId, cadenceId)

  return (
    <div className='flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4'>
      <Link
        href={`/${slug}/crm/cadences`}
        className='flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground'
      >
        <SteelIcon icon={ArrowLeft01Icon} className='size-3.5' />
        Cadências
      </Link>

      {cadence.isLoading ? (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-10 w-72' />
          <Skeleton className='h-24' />
          <Skeleton className='h-48' />
        </div>
      ) : cadence.isError || !cadence.data ? (
        <p className='text-destructive text-sm'>
          Não foi possível carregar a cadência.
        </p>
      ) : (
        <StatsBody
          cadence={cadence.data}
          workspaceId={workspaceId}
          cadenceId={cadenceId}
        />
      )}
    </div>
  )
}

function StatsBody({
  cadence,
  workspaceId,
  cadenceId,
}: {
  cadence: CrmCadenceDTO
  workspaceId: string
  cadenceId: string
}) {
  const stats = cadence.stats
  const enrolled = stats?.enrolled ?? 0
  const hasEmail = cadence.steps.some((step) => step.type === 'EMAIL')

  return (
    <>
      <div className='flex flex-wrap items-center gap-2'>
        <h2 className='font-semibold text-lg'>{cadence.name}</h2>
        <Badge variant={cadence.status === 'ACTIVE' ? 'secondary' : 'outline'}>
          {CADENCE_STATUS_LABEL[cadence.status]}
        </Badge>
      </div>

      <dl className='grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-3 xl:grid-cols-6'>
        <Tile label='Inscritos' value={enrolled} />
        <Tile label='Em andamento' value={stats?.active ?? 0} />
        <Tile label='Pausados' value={stats?.paused ?? 0} />
        <Tile
          label='Responderam'
          value={formatShare(stats?.replied ?? 0, enrolled)}
        />
        <Tile
          label='Concluíram'
          value={formatShare(stats?.completed ?? 0, enrolled)}
        />
        <Tile
          label='Encerrados'
          value={formatShare(stats?.stopped ?? 0, enrolled)}
          hint={
            cadence.stopOnClick && stats
              ? `${stats.stoppedByClick} por clique`
              : undefined
          }
        />
      </dl>

      <section className='flex flex-col gap-2'>
        <h3 className='font-medium text-sm'>Funil por passo</h3>
        <p className='text-muted-foreground text-xs'>
          &ldquo;Chegaram&rdquo; conta quem já passou pelo passo; as barras são
          a parte dos inscritos que chegou lá. Aberturas e cliques dos e-mails
          são estimativas: alguns programas de e-mail bloqueiam imagens ou abrem
          os links sozinhos.
        </p>
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Passo</TableHead>
                <TableHead className='min-w-40'>Chegaram</TableHead>
                <TableHead className='text-right'>Executados</TableHead>
                <TableHead className='text-right'>Pulados</TableHead>
                <TableHead className='text-right'>Falhas</TableHead>
                {hasEmail ? (
                  <>
                    <TableHead className='text-right'>Aberturas</TableHead>
                    <TableHead className='text-right'>Cliques</TableHead>
                  </>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cadence.steps.map((step) => {
                const counts =
                  stats?.sentByStep.find(
                    (item) => item.position === step.position,
                  ) ?? NO_STEP
                const isEmail = step.type === 'EMAIL'
                return (
                  <TableRow key={step.id}>
                    <TableCell>
                      <span className='font-medium'>
                        {step.position + 1}. {STEP_TYPE_LABEL[step.type]}
                      </span>
                      <span className='block text-muted-foreground text-xs'>
                        {describeDelay(
                          step.delayValue,
                          step.delayUnit,
                          step.position === 0,
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center gap-2'>
                        <div
                          className='h-2 flex-1 overflow-hidden rounded-full bg-muted'
                          role='img'
                          aria-label={`${counts.reached} de ${enrolled} inscritos chegaram a este passo`}
                        >
                          <div
                            className='h-full rounded-full bg-primary'
                            style={{
                              width: `${enrolled > 0 ? Math.min(100, (counts.reached / enrolled) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <span className='w-20 text-right text-xs tabular-nums'>
                          {formatShare(counts.reached, enrolled)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {counts.sent}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {counts.skipped}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        counts.failed > 0 && 'text-destructive',
                      )}
                    >
                      {counts.failed}
                    </TableCell>
                    {hasEmail ? (
                      <>
                        <TableCell className='text-right tabular-nums'>
                          {isEmail
                            ? formatShare(counts.opened, counts.sent)
                            : '—'}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {isEmail
                            ? formatShare(counts.clicked, counts.sent)
                            : '—'}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        {stats && enrolled > 0 ? (
          <p className='text-muted-foreground text-xs'>
            Taxa de resposta da cadência: {formatPercent(stats.replyRate)}.
          </p>
        ) : null}
      </section>

      <section className='flex flex-col gap-2'>
        <h3 className='font-medium text-sm'>Inscritos</h3>
        <CadenceEnrollmentsList
          workspaceId={workspaceId}
          cadenceId={cadenceId}
        />
      </section>
    </>
  )
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <div className='rounded-md bg-muted/50 p-2'>
      <dd className='font-semibold text-sm'>{value}</dd>
      <dt className='text-muted-foreground'>{label}</dt>
      {hint ? <p className='text-muted-foreground'>{hint}</p> : null}
    </div>
  )
}
