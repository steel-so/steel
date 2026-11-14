import z from 'zod'
import { isKnownTourKey } from '../lib/tours/registry'

export const TourProgressStatusValues = ['COMPLETED', 'SKIPPED'] as const

/** Marks a guided tour as seen by the session user. */
export const MarkTourSeenSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(isKnownTourKey, 'Tour desconhecido'),
  version: z.number().int().min(1).max(9999),
  status: z.enum(TourProgressStatusValues),
})

export type MarkTourSeenDTO = z.infer<typeof MarkTourSeenSchema>
