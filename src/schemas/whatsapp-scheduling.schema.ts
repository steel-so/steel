import { z } from 'zod'
import { isValidTimeZone } from '@/src/lib/whatsapp/scheduling/time'

const hour = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm')
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD')

export const SCHED_MAX_DURATION_MINUTES = 480
export const SCHED_MAX_OFFSETS = 3

export const SchedWeeklyHoursSchema = z
  .record(
    z.string().regex(/^[0-6]$/),
    z
      .array(z.object({ start: hour, end: hour }))
      .max(4, 'No máximo 4 janelas por dia'),
  )
  .superRefine((value, ctx) => {
    for (const [day, windows] of Object.entries(value)) {
      for (const window of windows) {
        if (window.start >= window.end) {
          ctx.addIssue({
            code: 'custom',
            path: [day],
            message: 'O início precisa ser antes do fim',
          })
        }
      }
    }
  })

// PATCH .../whatsapp/scheduling/settings
export const UpdateSchedulingSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  connectionId: z.string().min(1).nullable().optional(),
  timezone: z
    .string()
    .refine(isValidTimeZone, 'Fuso horário desconhecido')
    .optional(),
  slotMinutes: z.number().int().min(5).max(240).optional(),
  minNoticeMinutes: z.number().int().min(0).max(10_080).optional(),
  maxDaysAhead: z.number().int().min(1).max(180).optional(),
  confirmationTemplateId: z.string().min(1).nullable().optional(),
  reminderTemplateId: z.string().min(1).nullable().optional(),
  reminderOffsets: z
    .array(z.number().int().min(15).max(10_080))
    .max(SCHED_MAX_OFFSETS, 'No máximo 3 lembretes')
    .optional(),
  bookingFlowId: z.string().min(1).nullable().optional(),
})
export type UpdateSchedulingSettingsDTO = z.infer<
  typeof UpdateSchedulingSettingsSchema
>

export const CreateSchedServiceSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao serviço').max(80),
  description: z.string().trim().max(300).nullable().optional(),
  durationMinutes: z
    .number()
    .int()
    .min(5, 'A duração mínima é de 5 minutos')
    .max(SCHED_MAX_DURATION_MINUTES),
  bufferMinutes: z.number().int().min(0).max(240).default(0),
})
export type CreateSchedServiceDTO = z.infer<typeof CreateSchedServiceSchema>

export const UpdateSchedServiceSchema =
  CreateSchedServiceSchema.partial().extend({
    active: z.boolean().optional(),
  })
export type UpdateSchedServiceDTO = z.infer<typeof UpdateSchedServiceSchema>

export const CreateSchedProfessionalSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao profissional').max(80),
  userId: z.string().min(1).nullable().optional(),
  workingHours: SchedWeeklyHoursSchema.default({}),
  serviceIds: z.array(z.string().min(1)).max(100).default([]),
})
export type CreateSchedProfessionalDTO = z.infer<
  typeof CreateSchedProfessionalSchema
>

export const UpdateSchedProfessionalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  userId: z.string().min(1).nullable().optional(),
  active: z.boolean().optional(),
  workingHours: SchedWeeklyHoursSchema.optional(),
  serviceIds: z.array(z.string().min(1)).max(100).optional(),
})
export type UpdateSchedProfessionalDTO = z.infer<
  typeof UpdateSchedProfessionalSchema
>

// GET .../whatsapp/scheduling/slots?serviceId&date&professionalId&days
export const SchedSlotsQuerySchema = z.object({
  serviceId: z.string().min(1),
  date: dateKey,
  professionalId: z.string().min(1).optional(),
  days: z.coerce.number().int().min(1).max(14).default(1),
})
export type SchedSlotsQueryDTO = z.infer<typeof SchedSlotsQuerySchema>

// POST .../whatsapp/scheduling/appointments
export const CreateSchedAppointmentSchema = z.object({
  serviceId: z.string().min(1),
  professionalId: z.string().min(1),
  contactId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  startsAt: z.iso.datetime(),
  notes: z.string().trim().max(500).optional(),
  /** Sends the confirmation template right away (default). */
  notify: z.boolean().default(true),
})
export type CreateSchedAppointmentDTO = z.infer<
  typeof CreateSchedAppointmentSchema
>

// GET .../whatsapp/scheduling/appointments?from&to
export const SchedAppointmentsQuerySchema = z.object({
  from: dateKey,
  to: dateKey,
  professionalId: z.string().min(1).optional(),
  status: z
    .enum(['PENDING', 'CONFIRMED', 'CANCELED', 'COMPLETED', 'NO_SHOW'])
    .optional(),
})
export type SchedAppointmentsQueryDTO = z.infer<
  typeof SchedAppointmentsQuerySchema
>

// PATCH .../whatsapp/scheduling/appointments/{id}
export const UpdateSchedAppointmentSchema = z
  .object({
    status: z
      .enum(['CONFIRMED', 'CANCELED', 'COMPLETED', 'NO_SHOW'])
      .optional(),
    reason: z.string().trim().max(300).optional(),
    /** Moves the appointment to another start (same service). */
    startsAt: z.iso.datetime().optional(),
    professionalId: z.string().min(1).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar')
export type UpdateSchedAppointmentDTO = z.infer<
  typeof UpdateSchedAppointmentSchema
>
