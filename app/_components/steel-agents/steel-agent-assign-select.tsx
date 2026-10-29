'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { notify } from '@/lib/notify'
import {
  useAssignSteelAgent,
  useSteelAgentAssignment,
} from '@/src/hooks/use-steel-agent-assignment'
import { useSteelAgents } from '@/src/hooks/use-steel-agents'
import type { SteelAgentAssignmentEntityDTO } from '@/types/steel-agent'

const NONE = '__none__'

/**
 * "Atribuir ao agente": picks the Steel Agent that takes a ticket or a lead.
 * Choosing one queues a run for it with the record as context; "Nenhum"
 * removes the agent. Only enabled agents are offered (plus the current one,
 * so a paused agent still shows by name).
 */
export function SteelAgentAssignSelect({
  workspaceId,
  entityType,
  entityRef,
  disabled,
  className,
  id,
}: {
  workspaceId: string
  entityType: SteelAgentAssignmentEntityDTO
  /** Ticket id/number/code or lead id. */
  entityRef: string
  disabled?: boolean
  className?: string
  id?: string
}) {
  const agents = useSteelAgents(workspaceId)
  const assignment = useSteelAgentAssignment(workspaceId, entityType, entityRef)
  const assign = useAssignSteelAgent(workspaceId, entityType, entityRef)

  const current = assignment.data?.agent ?? null
  const options = (agents.data ?? []).filter(
    (agent) => agent.enabled || agent.id === current?.id,
  )
  // Nothing to choose from (no agents or no permission to list them): hide.
  if (!agents.isLoading && options.length === 0 && !current) return null

  const items = [
    { value: NONE, label: 'Nenhum' },
    ...options.map((agent) => ({
      value: agent.id,
      label: agent.enabled ? agent.name : `${agent.name} (pausado)`,
    })),
  ]

  function choose(next: string | null) {
    if (!next) return
    const agentId = next === NONE ? null : next
    if (agentId === (current?.id ?? null)) return
    assign.mutate(agentId, {
      onSuccess: (result) =>
        notify.success(
          result.agent
            ? `Atribuído a ${result.agent.name}. O agente já foi acionado.`
            : 'Agente removido.',
        ),
      onError: (error) => notify.error(error, 'Erro ao atribuir o agente'),
    })
  }

  return (
    <Select
      items={items}
      value={current?.id ?? NONE}
      disabled={disabled || assignment.isLoading || assign.isPending}
      onValueChange={choose}
    >
      <SelectTrigger id={id} aria-label='Agente de IA' className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
