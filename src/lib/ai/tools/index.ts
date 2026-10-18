import { SKILL_AI_TOOLS } from '../context/skill-tool'
import { CRM_AI_TOOLS } from './crm'
import { KNOWLEDGE_AI_TOOLS } from './knowledge'
import { PLATFORM_AI_TOOLS } from './platform'
import { SERVICEDESK_AI_TOOLS } from './servicedesk'
import type { AnySteelAiTool } from './types'
import { WHATSAPP_AI_TOOLS } from './whatsapp'

/**
 * Every Steel AI tool. Each module owns its own file; the runtime
 * (registry/filtering by mode, module and permission) lives elsewhere.
 */
export const STEEL_AI_TOOLS: readonly AnySteelAiTool[] = [
  ...PLATFORM_AI_TOOLS,
  ...KNOWLEDGE_AI_TOOLS,
  ...SERVICEDESK_AI_TOOLS,
  ...CRM_AI_TOOLS,
  ...WHATSAPP_AI_TOOLS,
  ...SKILL_AI_TOOLS,
]

export type * from './types'
