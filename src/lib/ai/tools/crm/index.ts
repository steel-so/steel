import type { AnySteelAiTool } from '../types'
import { crmAssignOwnerTool } from './assign'
import { CRM_BUILDER_TOOLS } from './builders'
import { CRM_CONTACT_TOOLS } from './contacts'
import { CRM_INSIGHT_TOOLS } from './insights'
import { CRM_LEAD_TOOLS } from './leads'
import { CRM_OPPORTUNITY_TOOLS } from './opportunities'
import { CRM_SOCIAL_TOOLS } from './social'
import { CRM_WORK_TOOLS } from './work'

/** Every CRM Steel AI tool (names prefixed `crm_`, module CRM). */
export const CRM_AI_TOOLS: AnySteelAiTool[] = [
  ...CRM_INSIGHT_TOOLS,
  ...CRM_LEAD_TOOLS,
  ...CRM_OPPORTUNITY_TOOLS,
  ...CRM_CONTACT_TOOLS,
  ...CRM_WORK_TOOLS,
  crmAssignOwnerTool,
  ...CRM_SOCIAL_TOOLS,
  ...CRM_BUILDER_TOOLS,
]
