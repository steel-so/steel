'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { useSteelAgents } from '@/src/hooks/use-steel-agents'

/** Most agents one agent may delegate to (mirrors the server limit). */
const MAX_DELEGATES = 10

/**
 * A7: picks the agents this one may hand a task to, as a tool. The delegated
 * agent runs with its own owner and tools; its cost is added to this run.
 */
export function SteelAgentDelegation({
  workspaceId,
  agentId,
  value,
  onChange,
  disabled,
}: {
  workspaceId: string
  /** Undefined while creating (an agent never lists itself). */
  agentId?: string
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const agents = useSteelAgents(workspaceId)
  const options = (agents.data ?? []).filter((a) => a.id !== agentId)
  if (options.length === 0) return null

  function toggle(id: string, on: boolean) {
    onChange(on ? [...value, id] : value.filter((v) => v !== id))
  }

  return (
    <section className='space-y-2' aria-label='Delegação a outros agentes'>
      <div>
        <h3 className='font-semibold text-sm'>Delegação a outros agentes</h3>
        <p className='text-muted-foreground text-sm'>
          Este agente pode entregar uma tarefa a outro, como se fosse uma
          ferramenta. O outro agente age com o próprio responsável e as próprias
          ferramentas, até 3 níveis, e o custo dele é somado a esta execução.
        </p>
      </div>
      <ul className='divide-y divide-border rounded-lg border'>
        {options.map((option) => {
          const checked = value.includes(option.id)
          const id = `agent-delegate-${option.id}`
          return (
            <li key={option.id} className='flex items-start gap-3 px-3 py-2.5'>
              <Checkbox
                id={id}
                checked={checked}
                disabled={
                  disabled || (!checked && value.length >= MAX_DELEGATES)
                }
                onCheckedChange={(next) => toggle(option.id, next === true)}
                className='mt-0.5'
              />
              <div className='min-w-0 flex-1'>
                <label htmlFor={id} className='font-medium text-sm'>
                  {option.name}
                </label>
                {option.description ? (
                  <p className='line-clamp-1 text-muted-foreground text-xs'>
                    {option.description}
                  </p>
                ) : null}
              </div>
              {!option.enabled ? (
                <span className='text-muted-foreground text-xs'>Pausado</span>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
