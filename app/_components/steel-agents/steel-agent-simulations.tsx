'use client'

import { UserMultipleIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSteelAgentSimulations } from '@/src/hooks/use-steel-agent-simulations'
import { formatAgentDate } from './steel-agent-labels'
import { SteelAgentSimulationBuilder } from './steel-agent-simulation-builder'
import {
  describeScoreboard,
  SIMULATION_STATUS_LABEL,
  SIMULATION_STATUS_VARIANT,
} from './steel-agent-simulation-labels'

export const SIMULATE_HINT =
  'Uma IA interpreta clientes (irritado, leigo, que pede exceção…) e conversa com o agente do começo ao fim. Outra IA avalia cada conversa. Consultas são reais; alterações só são simuladas.'

/** "Simulações" tab of the agent: history + the scenario builder. */
export function SteelAgentSimulations({
  workspaceId,
  slug,
  agentId,
  timezone,
  canSimulate,
}: {
  workspaceId: string
  slug: string
  agentId: string
  timezone: string
  canSimulate: boolean
}) {
  const simulations = useSteelAgentSimulations(workspaceId, agentId)
  const [building, setBuilding] = useState(false)
  const items = simulations.data ?? []

  return (
    <div className='space-y-3'>
      <div className='flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-center'>
        <SteelIcon
          icon={UserMultipleIcon}
          strokeWidth={2}
          className='hidden size-5 shrink-0 text-muted-foreground sm:block'
        />
        <p className='min-w-0 flex-1 text-muted-foreground text-sm'>
          {SIMULATE_HINT}
        </p>
        {canSimulate ? (
          <Button size='sm' onClick={() => setBuilding(true)}>
            Nova simulação
          </Button>
        ) : null}
      </div>

      {simulations.isLoading ? (
        <Skeleton className='h-24 rounded-xl' />
      ) : items.length === 0 ? (
        <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
          Nenhuma simulação ainda.
        </p>
      ) : (
        <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/${slug}/ai/agents/${agentId}/simulations/${item.id}`}
                className='flex flex-col items-start gap-1 px-4 py-3 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:flex-row sm:items-center sm:gap-3'
              >
                <Badge variant={SIMULATION_STATUS_VARIANT[item.status]}>
                  {SIMULATION_STATUS_LABEL[item.status]}
                </Badge>
                <span className='w-full min-w-0 flex-1 truncate text-sm sm:w-auto'>
                  {item.name}
                </span>
                <span className='shrink-0 whitespace-nowrap text-muted-foreground text-xs'>
                  {describeScoreboard(item)}
                  {item.avgScore !== null ? ` · nota ${item.avgScore}` : ''} ·{' '}
                  {formatAgentDate(item.createdAt, timezone)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canSimulate ? (
        <SteelAgentSimulationBuilder
          workspaceId={workspaceId}
          slug={slug}
          agentId={agentId}
          open={building}
          onOpenChange={setBuilding}
        />
      ) : null}
    </div>
  )
}
