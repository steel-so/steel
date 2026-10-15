'use client'

import { Crown02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  SiteExperimentDTO,
  SiteExperimentVariantKey,
} from '@/types/site-experiment'
import {
  formatCount,
  formatProbability,
  formatRate,
  formatUplift,
} from './format'

/**
 * Results of the current run of a test: visitors, conversions, rate,
 * uplift over the original and the probability of beating it. Until every
 * variant has enough visitors (and the test enough conversions) the
 * numbers show as preliminary, under "Ainda sem dados suficientes".
 */
export function ExperimentResults({
  experiment,
  canApply,
  onApply,
}: {
  experiment: SiteExperimentDTO
  /** The viewer can edit and the test has no applied winner yet. */
  canApply: boolean
  onApply: (key: SiteExperimentVariantKey) => void
}) {
  const { results } = experiment
  const maxRate = Math.max(...results.variants.map((item) => item.rate), 0)
  const winner = results.enoughData ? results.winner : null
  const winnerName = results.variants.find((item) => item.key === winner)?.name

  return (
    <div className='grid min-w-0 gap-3'>
      {!results.enoughData ? (
        <div
          role='status'
          data-testid='experiment-not-enough-data'
          className='grid gap-2 rounded-lg border border-dashed px-3 py-3 text-sm'
        >
          <p className='font-medium'>Ainda sem dados suficientes</p>
          <p className='text-muted-foreground text-xs'>
            Para ler as chances com segurança, cada variante precisa de{' '}
            {formatCount(results.minVisitorsPerVariant)} visitantes e o teste,
            de {formatCount(results.minConversions)} conversões. Até lá, os
            números abaixo são preliminares.
          </p>
          <ul className='grid gap-1.5 sm:grid-cols-3'>
            {results.variants.map((item) => {
              const progress = Math.min(
                1,
                item.visitors / results.minVisitorsPerVariant,
              )
              return (
                <li key={item.key} className='grid gap-1'>
                  <span className='flex justify-between gap-2 text-muted-foreground text-xs'>
                    <span className='truncate'>{item.name}</span>
                    <span className='tabular-nums'>
                      {formatCount(item.visitors)}/
                      {formatCount(results.minVisitorsPerVariant)}
                    </span>
                  </span>
                  <span
                    className='h-1.5 w-full rounded-sm bg-muted'
                    role='progressbar'
                    aria-label={`Visitantes de ${item.name}`}
                    aria-valuemin={0}
                    aria-valuemax={results.minVisitorsPerVariant}
                    aria-valuenow={Math.min(
                      item.visitors,
                      results.minVisitorsPerVariant,
                    )}
                  >
                    <span
                      className='block h-full rounded-sm bg-primary'
                      style={{ width: `${progress * 100}%` }}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : winner ? (
        <p
          role='status'
          className='flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-primary text-sm'
        >
          <SteelIcon icon={Crown02Icon} className='size-4 shrink-0' />
          {winner === 'A'
            ? 'O original vence: as variantes muito provavelmente convertem menos.'
            : `${winnerName} muito provavelmente converte mais que o original.`}
        </p>
      ) : (
        <p role='status' className='text-muted-foreground text-sm'>
          Nenhuma variante se destacou ainda (é preciso 95% de chance de vencer
          o original).
        </p>
      )}

      <div className='relative min-w-0 overflow-x-auto'>
        <table className='w-full min-w-[34rem] text-sm'>
          <caption className='sr-only'>
            Resultados da rodada {results.run} de {experiment.name}
          </caption>
          <thead>
            <tr className='border-b text-left text-muted-foreground text-xs'>
              <th scope='col' className='py-2 pr-3 font-medium'>
                Variante
              </th>
              <th scope='col' className='px-3 py-2 text-right font-medium'>
                Visitantes
              </th>
              <th scope='col' className='px-3 py-2 text-right font-medium'>
                Conversões
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                Taxa
              </th>
              <th scope='col' className='px-3 py-2 text-right font-medium'>
                Ganho
              </th>
              <th scope='col' className='px-3 py-2 text-right font-medium'>
                Chance de vencer
              </th>
              {canApply ? (
                <th scope='col' className='py-2 pl-3'>
                  <span className='sr-only'>Ações</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {results.variants.map((item) => {
              const leading = item.key === winner
              return (
                <tr
                  key={item.key}
                  data-variant={item.key}
                  className='border-b last:border-0'
                >
                  <th
                    scope='row'
                    className='min-w-44 py-2 pr-3 text-left font-medium'
                  >
                    <span className='flex flex-wrap items-center gap-1.5'>
                      <span className='flex size-5 shrink-0 items-center justify-center rounded bg-muted font-semibold text-[11px]'>
                        {item.key}
                      </span>
                      <span>{item.name}</span>
                      {leading ? (
                        <span className='inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary'>
                          <SteelIcon icon={Crown02Icon} className='size-3' />
                          Vencedora provável
                        </span>
                      ) : null}
                      {experiment.winnerKey === item.key ? (
                        <span className='inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground'>
                          Aplicada
                        </span>
                      ) : null}
                    </span>
                  </th>
                  <td className='px-3 py-2 text-right tabular-nums'>
                    {formatCount(item.visitors)}
                  </td>
                  <td className='px-3 py-2 text-right tabular-nums'>
                    {formatCount(item.conversions)}
                  </td>
                  <td className='px-3 py-2'>
                    <span className='flex items-center gap-2'>
                      <span className='w-12 shrink-0 text-right tabular-nums'>
                        {formatRate(item.rate)}
                      </span>
                      <span
                        className='h-1.5 min-w-10 flex-1 rounded-sm bg-muted'
                        aria-hidden
                      >
                        <span
                          className='block h-full rounded-sm bg-primary'
                          style={{
                            width: `${maxRate > 0 ? (item.rate / maxRate) * 100 : 0}%`,
                          }}
                        />
                      </span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      !results.enoughData && 'text-muted-foreground',
                    )}
                  >
                    {formatUplift(item.uplift)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      !results.enoughData && 'text-muted-foreground',
                    )}
                  >
                    {formatProbability(item.probabilityToBeat)}
                  </td>
                  {canApply ? (
                    <td className='py-2 pl-3 text-right'>
                      <Button
                        size='xs'
                        variant={leading ? 'default' : 'ghost'}
                        onClick={() => onApply(item.key)}
                        data-testid={`apply-variant-${item.key}`}
                      >
                        {leading ? 'Aplicar vencedora' : 'Aplicar'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
