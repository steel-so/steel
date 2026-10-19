'use client'

import { ArrowRight01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Small } from '@/components/typography/text/small'
import { Button } from '@/components/ui/button'
import { useAiInsights } from '@/src/hooks/use-ai-insights'
import { AiInsightCard } from './ai-insight-card'
import { useMinuteClock } from './ai-insight-feed'

export const AI_INSIGHT_HIGHLIGHTS = 3

export function aiInsightsFeedHref(slug: string): string {
  return `/${slug}/inbox?view=insights`
}

/**
 * "Para sua atenção": the few most severe active insights, compact, with a
 * link to the full feed in the inbox. Renders nothing while loading, on
 * error, with the proactive AI off or with nothing to show — the home and
 * the Steel AI screen stay as they were.
 */
export function AiInsightHighlights({
  workspaceId,
  slug,
  limit = AI_INSIGHT_HIGHLIGHTS,
  title = 'Para sua atenção',
}: {
  workspaceId: string
  slug: string
  limit?: number
  title?: string
}) {
  const feed = useAiInsights(workspaceId, { state: 'active', limit })
  const now = useMinuteClock()
  const data = feed.data
  if (!data?.enabled || data.items.length === 0) return null

  const more = data.counts.active - data.items.length

  return (
    <section aria-label={title} className='flex w-full min-w-0 flex-col gap-3'>
      <div className='flex w-full items-center justify-between gap-2'>
        <Small>{title}</Small>
        <Button
          size='xs'
          variant='ghost'
          nativeButton={false}
          render={<Link href={aiInsightsFeedHref(slug)} />}
        >
          {more > 0 ? `Ver todos (${data.counts.active})` : 'Ver todos'}
          <SteelIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
        </Button>
      </div>
      <div className='grid gap-3'>
        {data.items.map((insight) => (
          <AiInsightCard
            key={insight.id}
            workspaceId={workspaceId}
            slug={slug}
            insight={insight}
            now={now}
            compact
          />
        ))}
      </div>
    </section>
  )
}
