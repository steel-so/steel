'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type {
  SteelGovernanceAgentDTO,
  SteelGovernanceDTO,
} from '@/types/steel-governance'
import { formatAgentDate, TRIGGER_LABEL } from './steel-agent-labels'
import {
  formatRate,
  formatUsd,
  RISK_LABEL,
  ROLE_LABEL,
} from './steel-governance-labels'

const TIMEZONE = 'America/Sao_Paulo'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='truncate font-medium text-sm tabular-nums'>{value}</dd>
    </div>
  )
}

function AgentCard({
  agent,
  slug,
}: {
  agent: SteelGovernanceAgentDTO
  slug: string
}) {
  const m = agent.metrics
  const autoTools = agent.tools.filter(
    (t) => t.mode === 'AUTO' && t.kind !== 'READ',
  )
  return (
    <li className='space-y-3 px-4 py-3.5'>
      <div className='flex flex-wrap items-start gap-x-3 gap-y-1'>
        <div className='min-w-0 flex-1 space-y-0.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <Link
              href={`/${slug}/ai/agents/${agent.id}`}
              className='truncate font-medium text-sm hover:underline'
            >
              {agent.name}
            </Link>
            <Badge variant={agent.enabled ? 'secondary' : 'outline'}>
              {agent.enabled ? 'Ativo' : 'Pausado'}
            </Badge>
          </div>
          <p className='text-muted-foreground text-xs'>
            {TRIGGER_LABEL[agent.triggerType]} · Responsável:{' '}
            {agent.owner ? (
              <>
                {agent.owner.name}
                {agent.owner.role
                  ? ` (${ROLE_LABEL[agent.owner.role]})`
                  : ' (não é mais membro)'}
              </>
            ) : (
              'ninguém'
            )}
            {agent.createdByName ? ` · Criado por ${agent.createdByName}` : ''}
          </p>
        </div>
        <div className='flex flex-wrap gap-1'>
          {agent.risks.map((risk) => (
            <Badge
              key={risk}
              variant={risk === 'NO_OWNER' ? 'destructive' : 'outline'}
              className='font-normal'
            >
              {RISK_LABEL[risk]}
            </Badge>
          ))}
        </div>
      </div>

      <dl className='grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4'>
        <Metric label='Execuções' value={String(m.runs)} />
        <Metric
          label='Aprovadas / rejeitadas'
          value={`${m.approvals.approved} / ${m.approvals.rejected}`}
        />
        <Metric label='Taxa de aprovação' value={formatRate(m.approvalRate)} />
        <Metric label='Taxa de rejeição' value={formatRate(m.rejectionRate)} />
        <Metric label='Escritas aplicadas' value={String(m.applied)} />
        <Metric label='Custo' value={formatUsd(m.costUsd)} />
        <Metric label='Custo por escrita' value={formatUsd(m.costPerApplied)} />
        <Metric
          label='Última execução'
          value={formatAgentDate(m.lastRunAt, TIMEZONE)}
        />
      </dl>

      <p className='text-muted-foreground text-xs'>
        <span className='font-medium text-foreground'>Pode usar:</span>{' '}
        {agent.tools.length === 0
          ? 'nenhuma ferramenta'
          : `${agent.tools.length} ferramenta(s)`}
        {autoTools.length > 0
          ? ` · automáticas: ${autoTools.map((t) => t.label).join(', ')}`
          : ''}
        {agent.delegates.length > 0
          ? ` · delega a ${agent.delegates.map((d) => d.name).join(', ')}`
          : ''}
      </p>
    </li>
  )
}

/** A6 inventory: one card per agent with owner, permissions and metrics. */
export function SteelGovernanceInventory({
  data,
  slug,
}: {
  data: SteelGovernanceDTO
  slug: string
}) {
  if (data.agents.length === 0) {
    return (
      <p className='rounded-xl border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
        Nenhum agente neste workspace ainda.
      </p>
    )
  }
  return (
    <ul className='divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card'>
      {data.agents.map((agent) => (
        <AgentCard key={agent.id} agent={agent} slug={slug} />
      ))}
    </ul>
  )
}
