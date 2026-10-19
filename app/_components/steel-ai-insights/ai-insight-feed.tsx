'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAiInsights } from '@/src/hooks/use-ai-insights'
import {
  AI_INSIGHT_MODULE_LABELS,
  AI_INSIGHT_MODULES,
} from '@/src/lib/ai/proactive/labels'
import type { AiInsightModuleDTO, AiInsightStateDTO } from '@/types/ai-insight'
import { AiInsightCard } from './ai-insight-card'

const STATES: { value: AiInsightStateDTO; label: string }[] = [
  { value: 'active', label: 'Ativos' },
  { value: 'snoozed', label: 'Adiados' },
  { value: 'dismissed', label: 'Dispensados' },
]

const ALL = '__all__'

const EMPTY: Record<AiInsightStateDTO, string> = {
  active:
    'Nada pedindo atenção agora. Os alertas são recalculados a cada 15 minutos.',
  snoozed: 'Nenhum alerta adiado.',
  dismissed: 'Nenhum alerta dispensado.',
}

export const AI_INSIGHTS_DISABLED_MESSAGE =
  'A IA proativa está desligada neste espaço de trabalho. Um administrador pode ligá-la em Ajustes > Steel IA.'

/** Shared clock for the snooze countdowns (one tick a minute). */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/**
 * Full insights feed (inbox "Alertas da IA"): state tabs with counts, a
 * module filter and the cards. Each card acts on its own insight.
 */
export function AiInsightFeed({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [state, setState] = useState<AiInsightStateDTO>('active')
  const [module, setModule] = useState<string>(ALL)
  const now = useMinuteClock()
  const feed = useAiInsights(workspaceId, {
    state,
    module: module === ALL ? undefined : (module as AiInsightModuleDTO),
    limit: 50,
  })
  const data = feed.data
  const counts = data?.counts

  return (
    <section
      aria-label='Alertas da IA'
      className='mx-auto flex w-full max-w-3xl flex-col gap-4 p-4'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Tabs
          value={state}
          onValueChange={(value) => setState(value as AiInsightStateDTO)}
        >
          <TabsList aria-label='Situação dos alertas'>
            {STATES.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
                {counts && counts[item.value] > 0 ? (
                  <Badge
                    variant={item.value === 'active' ? 'secondary' : 'ghost'}
                  >
                    {counts[item.value]}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          items={[
            { value: ALL, label: 'Todos os módulos' },
            ...AI_INSIGHT_MODULES.map((item) => ({
              value: item,
              label: AI_INSIGHT_MODULE_LABELS[item],
            })),
          ]}
          value={module}
          onValueChange={(value) => setModule(value as string)}
        >
          <SelectTrigger
            className='w-full sm:ml-auto sm:w-48'
            aria-label='Filtrar por módulo'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={ALL}>Todos os módulos</SelectItem>
              {AI_INSIGHT_MODULES.map((item) => (
                <SelectItem key={item} value={item}>
                  {AI_INSIGHT_MODULE_LABELS[item]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {feed.isLoading ? (
        <div className='space-y-3' aria-busy='true'>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className='h-28 w-full rounded-xl' />
          ))}
        </div>
      ) : feed.isError ? (
        <p className='py-10 text-center text-destructive text-sm'>
          Não foi possível carregar os alertas da IA.
        </p>
      ) : data && !data.enabled ? (
        <p className='py-10 text-center text-muted-foreground text-sm'>
          {AI_INSIGHTS_DISABLED_MESSAGE}
        </p>
      ) : !data || data.items.length === 0 ? (
        <p className='py-10 text-center text-muted-foreground text-sm'>
          {EMPTY[state]}
        </p>
      ) : (
        <div className='space-y-3'>
          {data.items.map((insight) => (
            <AiInsightCard
              key={insight.id}
              workspaceId={workspaceId}
              slug={slug}
              insight={insight}
              now={now}
            />
          ))}
        </div>
      )}
    </section>
  )
}
