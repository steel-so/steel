import z from 'zod'
import { sdDescription, sdName } from './sd-config.schema'
import {
  type SdAutomationAction,
  SdAutomationActionsSchema,
  SdConditionsSchema,
} from './sd-rule.schema'

export const SD_AUTOMATION_EVENTS = [
  'TICKET_CREATED',
  'TICKET_UPDATED',
  'PHASE_CHANGED',
  'MESSAGE_RECEIVED',
  'APPROVAL_RESPONDED',
  'SLA_AT_RISK',
  'SLA_BREACHED',
] as const
export const SdAutomationEventEnum = z.enum(SD_AUTOMATION_EVENTS)

export const CreateSdAutomationRuleSchema = z.object({
  name: sdName,
  description: sdDescription,
  event: SdAutomationEventEnum,
  conditions: SdConditionsSchema.default([]),
  actions: SdAutomationActionsSchema,
  stopProcessing: z.boolean().default(false),
  active: z.boolean().default(true),
})
export type CreateSdAutomationRuleDTO = z.infer<
  typeof CreateSdAutomationRuleSchema
>

export const UpdateSdAutomationRuleSchema = z
  .object({
    name: sdName.optional(),
    description: sdDescription,
    event: SdAutomationEventEnum.optional(),
    conditions: SdConditionsSchema.optional(),
    actions: SdAutomationActionsSchema.optional(),
    stopProcessing: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })
export type UpdateSdAutomationRuleDTO = z.infer<
  typeof UpdateSdAutomationRuleSchema
>

export const ListSdAutomationRulesSchema = z.object({
  event: SdAutomationEventEnum.optional(),
})
export type ListSdAutomationRulesDTO = z.infer<
  typeof ListSdAutomationRulesSchema
>

/** Ids que as ações referenciam (para validar que são da workspace). */
export function sdAutomationActionRefs(actions: SdAutomationAction[]): {
  departmentIds: string[]
  userIds: string[]
  templateIds: string[]
} {
  const departmentIds: string[] = []
  const userIds: string[] = []
  const templateIds: string[] = []
  for (const action of actions) {
    switch (action.type) {
      case 'assign_department':
        departmentIds.push(action.params.departmentId)
        break
      case 'round_robin':
        if (action.params.departmentId) {
          departmentIds.push(action.params.departmentId)
        }
        break
      case 'assign_user':
      case 'add_participant':
        userIds.push(action.params.userId)
        break
      case 'notify':
        userIds.push(...action.params.userIds)
        break
      case 'create_task':
      case 'create_crm_task':
        if (action.params.assigneeId) userIds.push(action.params.assigneeId)
        break
      case 'apply_template':
        templateIds.push(action.params.templateId)
        break
      case 'escalate':
        if (action.params.toDepartmentId) {
          departmentIds.push(action.params.toDepartmentId)
        }
        if (action.params.toUserId) userIds.push(action.params.toUserId)
        break
      default:
        break
    }
  }
  return { departmentIds, userIds, templateIds }
}
