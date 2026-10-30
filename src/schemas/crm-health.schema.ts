import { z } from 'zod'

export const CrmHealthLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH'])

/** `GET .../crm/health/companies`: the customers ranked by risk. */
export const ListCrmCustomerHealthQuerySchema = z.object({
  level: CrmHealthLevelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListCrmCustomerHealthQuery = z.infer<
  typeof ListCrmCustomerHealthQuerySchema
>

/** `GET .../crm/health/opportunities`: the health badges of a board. */
export const ListCrmOpportunityHealthQuerySchema = z.object({
  pipelineId: z.string().min(1).optional(),
  level: CrmHealthLevelSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
})
export type ListCrmOpportunityHealthQuery = z.infer<
  typeof ListCrmOpportunityHealthQuerySchema
>
