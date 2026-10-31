import z from 'zod'
import { SD_STATUS_COMPONENT_STATES } from '@/src/lib/servicedesk/status-maintenance'

const Id = z.string().trim().min(1).max(64)

export const SdStatusComponentStateSchema = z.enum(SD_STATUS_COMPONENT_STATES)

export const CreateSdStatusComponentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Catalog service the component mirrors (optional). */
  serviceId: Id.optional(),
  state: SdStatusComponentStateSchema.default('OPERATIONAL'),
})

export const UpdateSdStatusComponentSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    serviceId: Id.nullable(),
    state: SdStatusComponentStateSchema,
    position: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })

const DateTime = z.iso
  .datetime({ offset: true, message: 'Data e hora inválidas' })
  .transform((value) => new Date(value))

const maintenanceShape = {
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).nullable(),
  startsAt: DateTime,
  endsAt: DateTime,
  pageIds: z.array(Id).min(1, 'Escolha ao menos uma página').max(20),
  suppressMonitoring: z.boolean(),
  configItemIds: z.array(Id).max(100),
  notifySubscribers: z.boolean(),
}

export const CreateSdMaintenanceSchema = z.object({
  ...maintenanceShape,
  description: maintenanceShape.description.optional(),
  suppressMonitoring: maintenanceShape.suppressMonitoring.default(false),
  configItemIds: maintenanceShape.configItemIds.default([]),
  notifySubscribers: maintenanceShape.notifySubscribers.default(true),
})

export const UpdateSdMaintenanceSchema = z
  .object(maintenanceShape)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })

export type CreateSdStatusComponentInput = z.infer<
  typeof CreateSdStatusComponentSchema
>
export type UpdateSdStatusComponentInput = z.infer<
  typeof UpdateSdStatusComponentSchema
>
export type CreateSdMaintenanceInput = z.infer<typeof CreateSdMaintenanceSchema>
export type UpdateSdMaintenanceInput = z.infer<typeof UpdateSdMaintenanceSchema>
