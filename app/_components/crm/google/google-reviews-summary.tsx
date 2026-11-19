'use client'

import { ResponsiveLine } from '@nivo/line'
import {
  CHART_THEME,
  formatAxisLabel,
} from '@/app/_components/crm/social/chart-utils'
import { Card } from '@/components/ui/card'
import type { GoogleReviewsSummaryDTO } from '@/src/schemas/crm-google-presence.schema'
import { formatInt, formatRating } from './google-format'
import { GoogleStars } from './google-stars'

/** Average rating, distribution, response rate and the monthly evolution. */
export function GoogleReviewsSummary({
  summary,
  activeRating,
  onPickRating,
}: {
  summary: GoogleReviewsSummaryDTO
  activeRating: number | undefined
  onPickRating: (rating: number | undefined) => void
}) {
  const total = summary.cachedCount
  const points = summary.evolution.filter((p) => p.cumulativeAverage !== null)

  return (
    <div className='grid gap-4 lg:grid-cols-[1fr_1.2fr]'>
      <Card className='gap-4 px-5 py-5'>
        <div className='flex items-center gap-4'>
          <div className='text-center'>
            <p className='font-heading font-semibold text-5xl tabular-nums tracking-tight'>
              {summary.averageRating !== null
                ? formatRating(summary.averageRating)
                : '–'}
            </p>
            {summary.averageRating !== null ? (
              <GoogleStars value={summary.averageRating} size={16} />
            ) : null}
            <p className='mt-1 text-muted-foreground text-xs'>
              {formatInt(summary.totalReviewCount ?? total)} avaliações
            </p>
          </div>
          <ul className='min-w-0 flex-1 space-y-1.5'>
            {([5, 4, 3, 2, 1] as const).map((stars) => {
              const count = summary.distribution[String(stars) as '1']
              const active = activeRating === stars
              return (
                <li key={stars}>
                  <button
                    type='button'
                    aria-pressed={active}
                    aria-label={`Filtrar avaliações de ${stars} estrelas`}
                    onClick={() => onPickRating(active ? undefined : stars)}
                    className='flex w-full items-center gap-2 text-xs'
                  >
                    <span className='w-3 text-right tabular-nums'>{stars}</span>
                    <span className='h-2 flex-1 overflow-hidden rounded-full bg-muted'>
                      <span
                        className={`block h-full rounded-full ${active ? 'bg-primary' : 'bg-amber-400'}`}
                        style={{
                          width: total > 0 ? `${(count / total) * 100}%` : '0%',
                        }}
                      />
                    </span>
                    <span className='w-8 text-right text-muted-foreground tabular-nums'>
                      {formatInt(count)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className='grid grid-cols-3 gap-3 border-t border-border/60 pt-4 text-center'>
          <div>
            <p className='font-heading font-semibold text-xl tabular-nums'>
              {summary.responseRate !== null
                ? `${Math.round(summary.responseRate * 100)}%`
                : '–'}
            </p>
            <p className='text-muted-foreground text-xs'>respondidas</p>
          </div>
          <div>
            <p className='font-heading font-semibold text-xl tabular-nums'>
              {formatInt(summary.repliedCount)}
            </p>
            <p className='text-muted-foreground text-xs'>com resposta</p>
          </div>
          <div>
            <p className='font-heading font-semibold text-xl tabular-nums'>
              {formatInt(summary.unrepliedCount)}
            </p>
            <p className='text-muted-foreground text-xs'>sem resposta</p>
          </div>
        </div>
      </Card>

      <Card className='h-60 gap-0 p-2 text-muted-foreground'>
        <p className='px-3 pt-2 font-medium text-foreground text-sm'>
          Evolução da nota
        </p>
        {points.length >= 2 ? (
          <ResponsiveLine
            data={[
              {
                id: 'Nota acumulada',
                data: points.map((p) => ({
                  x: p.month,
                  y: p.cumulativeAverage as number,
                })),
              },
              {
                id: 'Nota do mês',
                data: points
                  .filter((p) => p.average !== null)
                  .map((p) => ({ x: p.month, y: p.average as number })),
              },
            ]}
            margin={{ top: 16, right: 20, bottom: 40, left: 40 }}
            colors={['#f59e0b', '#94a3b8']}
            curve='monotoneX'
            pointSize={5}
            useMesh
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 1, max: 5 }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              format: formatAxisLabel,
            }}
            axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 5 }}
            theme={CHART_THEME}
            enableGridX={false}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center px-6 text-center text-sm'>
            A evolução aparece quando houver avaliações em pelo menos dois
            meses.
          </div>
        )}
      </Card>
    </div>
  )
}
