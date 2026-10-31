import type { ModuleKind } from '@prisma/client'
import type {
  AiSkillTemplate,
  AiTemplateToolSpec,
  SteelAgentTemplate,
} from '@/src/lib/ai/templates/types'
import type { AiToolKind } from '@/src/lib/ai/tools/types'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import type {
  AiSkillTemplateDTO,
  AiTemplateToolDTO,
  SteelAgentTemplateDTO,
} from '@/types/ai-template'

/** What the mapper needs to know about a registry tool. */
export interface AiTemplateToolInfo {
  label: string
  module: ModuleKind | null
  kind: AiToolKind
}

export type AiTemplateToolLookup = (
  name: string,
) => AiTemplateToolInfo | undefined

const MODULE_NAME: Record<ModuleKind, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
}

/** pt-BR reason a template cannot be used, or null when it can. */
export function templateUnavailableReason(
  missing: ModuleKind[],
): string | null {
  if (missing.length === 0) return null
  const names = missing.map((module) => MODULE_NAME[module])
  if (names.length === 1) return `Requer o módulo ${names[0]} habilitado.`
  const list = `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
  return `Requer os módulos ${list} habilitados.`
}

/**
 * Tools of a template as the editor will get them. Unknown tools are
 * dropped; when the template is usable, tools of disabled modules are
 * dropped too (the create endpoint would refuse them). An unusable
 * template keeps every tool so the gallery can still explain it.
 */
function templateTools(
  specs: AiTemplateToolSpec[],
  lookup: AiTemplateToolLookup,
  enabled: ModuleKind[],
  available: boolean,
): AiTemplateToolDTO[] {
  const out: AiTemplateToolDTO[] = []
  for (const spec of specs) {
    const tool = lookup(spec.toolName)
    if (!tool) continue
    if (available && tool.module && !enabled.includes(tool.module)) continue
    out.push({
      toolName: spec.toolName,
      label: tool.label,
      module: tool.module,
      kind: tool.kind,
      mode:
        tool.kind === 'READ' ? 'AUTO' : effectiveToolMode(tool.kind, spec.mode),
    })
  }
  return out
}

function availability(
  template: { modules: ModuleKind[] },
  enabled: ModuleKind[],
) {
  const missing = template.modules.filter((module) => !enabled.includes(module))
  return {
    available: missing.length === 0,
    unavailableReason: templateUnavailableReason(missing),
  }
}

export function toSteelAgentTemplateDTO(
  template: SteelAgentTemplate,
  enabled: ModuleKind[],
  lookup: AiTemplateToolLookup,
): SteelAgentTemplateDTO {
  const state = availability(template, enabled)
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    modules: [...template.modules],
    instructions: template.instructions,
    tools: templateTools(template.tools, lookup, enabled, state.available),
    ...state,
    triggerType: template.triggerType,
    cron: template.cron,
    scheduleLabel: template.scheduleLabel,
    timezone: template.timezone,
    eventKey: template.eventKey ?? null,
    maxToolRounds: template.maxToolRounds,
  }
}

export function toAiSkillTemplateDTO(
  template: AiSkillTemplate,
  enabled: ModuleKind[],
  lookup: AiTemplateToolLookup,
): AiSkillTemplateDTO {
  const state = availability(template, enabled)
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    modules: [...template.modules],
    instructions: template.instructions,
    tools: templateTools(
      template.toolNames.map((toolName) => ({ toolName, mode: 'AUTO' })),
      lookup,
      enabled,
      state.available,
    ),
    ...state,
    slug: template.slug,
    mode: template.mode,
  }
}
