import type { AiConversationMode, ModuleKind } from '@prisma/client'
import type { SteelAgentToolMode } from '@/src/lib/steel-agents/tool-mode'

/**
 * Ready-made Steel AI templates for workspace admins. Like the built-in
 * skills they live in code (no seeding): picking one only pre-fills the
 * agent editor or the skill form, and the saved agent/skill is a normal,
 * editable workspace record.
 */

export type AiTemplateCategory =
  | 'SERVICE_DESK'
  | 'CRM'
  | 'COMMUNICATION'
  | 'GOVERNANCE'
  | 'MANAGEMENT'

export interface AiTemplateToolSpec {
  toolName: string
  /** Suggested mode; reads are AUTO, writes APPROVAL (deletes always). */
  mode: SteelAgentToolMode
}

interface AiTemplateBase {
  /** Stable id (kebab-case), also used in `?template=<id>`. */
  id: string
  name: string
  description: string
  category: AiTemplateCategory
  /** Modules that must all be enabled; `[]` = platform (any workspace). */
  modules: ModuleKind[]
  instructions: string
}

export interface SteelAgentTemplate extends AiTemplateBase {
  triggerType: 'SCHEDULE' | 'EVENT' | 'MANUAL'
  /** Event key (EVENT only), from `STEEL_AGENT_EVENTS`. */
  eventKey?: string | null
  /** Five-field cron, in `timezone` (SCHEDULE only). */
  cron: string | null
  /** pt-BR description of the schedule, shown in the gallery. */
  scheduleLabel: string
  timezone: string
  maxToolRounds: number
  /**
   * Tools of modules that are not enabled are dropped when the template is
   * offered (cross-module templates degrade gracefully).
   */
  tools: AiTemplateToolSpec[]
}

export interface AiSkillTemplate extends AiTemplateBase {
  /** Suggested command; never equal to a built-in skill's. */
  slug: string
  mode: AiConversationMode | null
  toolNames: string[]
}
