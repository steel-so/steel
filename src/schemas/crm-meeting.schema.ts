import { z } from 'zod'
import { isValidTimezone, parseClock } from '@/src/lib/crm-meetings/tz'

const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(isValidTimezone, 'Fuso horário inválido')

export const MeetingSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'O endereço precisa de ao menos 3 caracteres')
  .max(60)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use letras minúsculas, números e hífens',
  )

export const MeetingFormatSchema = z.enum(['IN_PERSON', 'ONLINE'])

const HourWindowSchema = z
  .object({
    start: z.string().refine((v) => parseClock(v) !== null, 'Horário inválido'),
    end: z.string().refine((v) => parseClock(v) !== null, 'Horário inválido'),
  })
  .refine(
    (w) => (parseClock(w.end) ?? 0) > (parseClock(w.start) ?? 0),
    'O fim precisa ser depois do início',
  )

export const WeeklyHoursSchema = z
  .record(z.string().regex(/^[0-6]$/), z.array(HourWindowSchema).max(6))
  .default({})

export type WeeklyHoursInput = z.infer<typeof WeeklyHoursSchema>

const PageFields = {
  title: z.string().trim().min(2, 'Informe o título').max(120),
  description: z.string().trim().max(1000).nullish(),
  durationMinutes: z.number().int().min(10).max(240).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14)
    .default(120),
  maxDaysAhead: z.number().int().min(1).max(180).default(30),
  slotStepMinutes: z.number().int().min(5).max(120).default(30),
  timezone: TimezoneSchema.default('America/Sao_Paulo'),
  format: MeetingFormatSchema.default('ONLINE'),
  location: z.string().trim().max(300).nullish(),
  reminderMinutes: z
    .number()
    .int()
    .min(0)
    .max(60 * 48)
    .default(60),
  leadSource: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .default('Agendamento de reunião'),
  active: z.boolean().default(true),
  hostUserIds: z
    .array(z.string().trim().min(1))
    .min(1, 'Escolha ao menos um vendedor')
    .max(20),
}

export const CreateCrmMeetingPageSchema = z.object({
  ...PageFields,
  slug: MeetingSlugSchema.optional(),
})
export type CreateCrmMeetingPageDTO = z.infer<typeof CreateCrmMeetingPageSchema>

export const UpdateCrmMeetingPageSchema = z
  .object({ ...PageFields, slug: MeetingSlugSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar')
export type UpdateCrmMeetingPageDTO = z.infer<typeof UpdateCrmMeetingPageSchema>

export const UpdateCrmMeetingAvailabilitySchema = z.object({
  timezone: TimezoneSchema,
  weeklyHours: WeeklyHoursSchema,
  /** `null` or empty removes the calendar feed. */
  icsUrl: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((v) => (v ? v : null)),
})
export type UpdateCrmMeetingAvailabilityDTO = z.infer<
  typeof UpdateCrmMeetingAvailabilitySchema
>

export const ListCrmMeetingBookingsSchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  mine: z.coerce.boolean().default(false),
})
export type ListCrmMeetingBookingsDTO = z.infer<
  typeof ListCrmMeetingBookingsSchema
>

export const PublicSlotsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  days: z.coerce.number().int().min(1).max(31).default(14),
})
export type PublicSlotsQueryDTO = z.infer<typeof PublicSlotsQuerySchema>

export const BookCrmMeetingSchema = z.object({
  startsAt: z.string().datetime(),
  name: z.string().trim().min(2, 'Informe seu nome').max(120),
  email: z.string().trim().toLowerCase().email('E-mail inválido').max(200),
  phone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  timezone: TimezoneSchema.default('America/Sao_Paulo'),
  /** LGPD: the guest agrees the data is used to schedule and follow up. */
  consent: z.literal(true, { message: 'É preciso concordar para agendar' }),
})
export type BookCrmMeetingDTO = z.infer<typeof BookCrmMeetingSchema>
