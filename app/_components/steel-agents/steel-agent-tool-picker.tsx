'use client'

import { LockIcon, Settings02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { STEEL_AI_MODULE_META } from '@/app/_components/steel-ai/steel-ai-starters'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type {
  SteelAgentToolCatalogItemDTO,
  SteelAgentToolModeDTO,
} from '@/types/steel-agent'
import type { AiModuleDTO } from '@/types/steel-ai'

export interface SteelAgentToolSelection {
  toolName: string
  mode: SteelAgentToolModeDTO
}

type ToolGroup = AiModuleDTO | 'PLATFORM' | 'MCP'

const GROUP_ORDER: ToolGroup[] = [
  'PLATFORM',
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
  'MCP',
]

function groupOf(tool: SteelAgentToolCatalogItemDTO): ToolGroup {
  if (tool.external) return 'MCP'
  return tool.module ?? 'PLATFORM'
}

const KIND_LABEL: Record<SteelAgentToolCatalogItemDTO['kind'], string> = {
  READ: 'Leitura',
  CREATE: 'Criar',
  UPDATE: 'Alterar',
  DELETE: 'Excluir',
  ACTION: 'Ação',
}

function groupLabel(group: ToolGroup): string {
  if (group === 'PLATFORM') return 'Plataforma'
  if (group === 'MCP') return 'Servidores MCP externos'
  return STEEL_AI_MODULE_META[group].label
}

/**
 * Picks the registry tools an agent may call. Writes are "Automática" or
 * "Requer aprovação" (default); DELETE tools are locked to approval — the
 * server enforces it too.
 */
export function SteelAgentToolPicker({
  tools,
  value,
  onChange,
  disabled,
  autoAllowedTools = null,
}: {
  tools: SteelAgentToolCatalogItemDTO[]
  value: SteelAgentToolSelection[]
  onChange: (next: SteelAgentToolSelection[]) => void
  disabled?: boolean
  /** A8: tools the caller's role may set to AUTO (null = no limit). */
  autoAllowedTools?: string[] | null
}) {
  const selected = new Map(value.map((t) => [t.toolName, t.mode]))

  function toggle(tool: SteelAgentToolCatalogItemDTO, on: boolean) {
    if (on) {
      onChange([...value, { toolName: tool.name, mode: 'APPROVAL' }])
    } else {
      onChange(value.filter((t) => t.toolName !== tool.name))
    }
  }

  function setMode(tool: SteelAgentToolCatalogItemDTO, auto: boolean) {
    onChange(
      value.map((t) =>
        t.toolName === tool.name
          ? { ...t, mode: auto && tool.kind !== 'DELETE' ? 'AUTO' : 'APPROVAL' }
          : t,
      ),
    )
  }

  const groups = GROUP_ORDER.map((group) => ({
    group,
    items: tools.filter((t) => groupOf(t) === group),
  })).filter((g) => g.items.length > 0)

  if (groups.length === 0) {
    return (
      <p className='rounded-lg border border-dashed p-4 text-muted-foreground text-sm'>
        Nenhuma ferramenta disponível para os módulos habilitados.
      </p>
    )
  }

  return (
    <div className='space-y-4'>
      {groups.map(({ group, items }) => (
        <section
          key={group}
          aria-label={groupLabel(group)}
          className='space-y-1.5'
        >
          <h4 className='flex items-center gap-1.5 font-medium text-muted-foreground text-xs'>
            {group !== 'PLATFORM' && group !== 'MCP' ? (
              <SteelIcon
                icon={STEEL_AI_MODULE_META[group].icon}
                strokeWidth={2}
                className='size-3.5'
              />
            ) : (
              <SteelIcon
                icon={Settings02Icon}
                strokeWidth={2}
                className='size-3.5'
              />
            )}
            {groupLabel(group)}
          </h4>
          <ul className='divide-y divide-border rounded-lg border'>
            {items.map((tool) => {
              const checked = selected.has(tool.name)
              const mode = selected.get(tool.name)
              const isWrite = tool.kind !== 'READ'
              const locked = tool.kind === 'DELETE'
              const auto = !locked && mode === 'AUTO'
              const roleBlocked =
                isWrite &&
                autoAllowedTools !== null &&
                !autoAllowedTools.includes(tool.name)
              const id = `agent-tool-${tool.name}`
              return (
                <li
                  key={tool.name}
                  className={cn(
                    'flex flex-wrap items-start gap-3 px-3 py-2.5',
                    checked && 'bg-muted/40',
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(next) => toggle(tool, next === true)}
                    className='mt-0.5'
                  />
                  <div className='min-w-0 flex-1 space-y-0.5'>
                    <div className='flex flex-wrap items-center gap-1.5'>
                      <label htmlFor={id} className='font-medium text-sm'>
                        {tool.label}
                      </label>
                      <Badge
                        variant={locked ? 'destructive' : 'outline'}
                        className='font-normal'
                      >
                        {KIND_LABEL[tool.kind]}
                      </Badge>
                    </div>
                    <p className='line-clamp-2 text-muted-foreground text-xs'>
                      {tool.description}
                    </p>
                  </div>
                  {checked && isWrite ? (
                    <div className='flex shrink-0 items-center gap-2 text-xs'>
                      {locked ? (
                        <span className='flex items-center gap-1 text-muted-foreground'>
                          <SteelIcon
                            icon={LockIcon}
                            strokeWidth={2}
                            className='size-3.5'
                          />
                          Sempre requer aprovação
                        </span>
                      ) : roleBlocked && !auto ? (
                        <span className='flex items-center gap-1 text-muted-foreground'>
                          <SteelIcon
                            icon={LockIcon}
                            strokeWidth={2}
                            className='size-3.5'
                          />
                          Seu perfil não libera o automático
                        </span>
                      ) : (
                        <>
                          <Switch
                            size='sm'
                            checked={auto}
                            disabled={disabled}
                            onCheckedChange={(next) => setMode(tool, next)}
                            aria-label={`Executar ${tool.label} automaticamente`}
                          />
                          <span
                            className={cn(
                              'w-28',
                              auto
                                ? 'text-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            {auto ? 'Automática' : 'Requer aprovação'}
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
