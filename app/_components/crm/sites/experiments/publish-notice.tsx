'use client'

import { Refresh01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import type { SiteExperimentImpactDTO } from '@/types/site-experiment'

/**
 * Warning of the publish dialog: running A/B tests whose variants this
 * publish changes start a new run (their results reset), so the visitor
 * never sees content the numbers do not describe.
 */
export function ExperimentPublishNotice({
  impact,
}: {
  impact: SiteExperimentImpactDTO | undefined
}) {
  const tests = impact?.experiments ?? []
  if (tests.length === 0) return null
  return (
    <div
      role='alert'
      data-testid='publish-experiments-notice'
      className='flex items-start gap-2 rounded-md border px-3 py-2 text-sm'
    >
      <SteelIcon
        icon={Refresh01Icon}
        className='mt-0.5 size-4 shrink-0 text-muted-foreground'
      />
      <div className='grid gap-1'>
        <p className='font-medium'>
          {tests.length === 1
            ? 'Publicar reinicia 1 teste A/B'
            : `Publicar reinicia ${tests.length} testes A/B`}
        </p>
        <p className='text-muted-foreground text-xs'>
          As variantes mudaram desde o início do teste, então os resultados
          recomeçam do zero: {tests.map((test) => `“${test.name}”`).join(', ')}.
        </p>
      </div>
    </div>
  )
}
