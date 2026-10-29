import z from 'zod'
import {
  SD_MAJOR_INCIDENT_IMPACTS,
  SD_MAJOR_INCIDENT_MAX_LINK_BATCH,
  SD_MAJOR_INCIDENT_STATUSES,
} from '@/src/lib/servicedesk/major-incident'
import { SD_SWARM_MAX_MEMBERS } from '@/src/lib/servicedesk/swarm'

const Id = z.string().trim().min(1).max(64)
const TicketRefs = z
  .array(z.string().trim().min(1).max(40))
  .min(1)
  .max(SD_MAJOR_INCIDENT_MAX_LINK_BATCH)

export const SdMajorIncidentImpactSchema = z.enum(SD_MAJOR_INCIDENT_IMPACTS)
export const SdMajorIncidentStatusSchema = z.enum(SD_MAJOR_INCIDENT_STATUSES)

export const DeclareSdMajorIncidentSchema = z.object({
  /** Master ticket: id, number (`123`) or code (`INC-000123`). */
  ticketRef: z.string().trim().min(1).max(40),
  /** Customer-safe: shows on the public status pages. */
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(2000).optional(),
  impact: SdMajorIncidentImpactSchema.default('PARTIAL_OUTAGE'),
  commanderId: Id.optional(),
  /** Pages that show the incident; omitted = the pages that match the ticket. */
  pageIds: z.array(Id).max(20).optional(),
  /** Child tickets to link right away. */
  childTicketRefs: TicketRefs.optional(),
  /** First public message of the timeline. */
  initialMessage: z.string().trim().min(3).max(2000).optional(),
  /** Publish the first message on the pages and notify the subscribers. */
  publishInitial: z.boolean().default(true),
  /** War room: opens a swarm on the master ticket with these specialists. */
  warRoom: z
    .object({
      userIds: z.array(Id).min(1).max(SD_SWARM_MAX_MEMBERS),
      openSlackChannel: z.boolean().default(false),
    })
    .optional(),
})

export const UpdateSdMajorIncidentSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    summary: z.string().trim().max(2000).nullable(),
    impact: SdMajorIncidentImpactSchema,
    commanderId: Id.nullable(),
    pageIds: z.array(Id).max(20),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })

export const AddSdMajorIncidentUpdateSchema = z.object({
  status: SdMajorIncidentStatusSchema.exclude(['RESOLVED']),
  message: z.string().trim().min(3).max(2000),
  /** Publish on the status pages and notify the subscribers. */
  publish: z.boolean().default(true),
  /** The impact changed with this update. */
  impact: SdMajorIncidentImpactSchema.optional(),
})

export const ResolveSdMajorIncidentSchema = z.object({
  /** Public closing message. */
  message: z.string().trim().min(3).max(2000),
  /** Internal note: what fixed it (kept on the incident and master ticket). */
  resolution: z.string().trim().max(4000).optional(),
  publish: z.boolean().default(true),
})

export const LinkSdMajorIncidentTicketsSchema = z.object({
  ticketRefs: TicketRefs,
})

export const ListSdMajorIncidentsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'RESOLVED', 'ALL']).default('ACTIVE'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type DeclareSdMajorIncidentInput = z.infer<
  typeof DeclareSdMajorIncidentSchema
>
export type UpdateSdMajorIncidentInput = z.infer<
  typeof UpdateSdMajorIncidentSchema
>
export type AddSdMajorIncidentUpdateInput = z.infer<
  typeof AddSdMajorIncidentUpdateSchema
>
export type ResolveSdMajorIncidentInput = z.infer<
  typeof ResolveSdMajorIncidentSchema
>
export type LinkSdMajorIncidentTicketsInput = z.infer<
  typeof LinkSdMajorIncidentTicketsSchema
>
export type ListSdMajorIncidentsQuery = z.infer<
  typeof ListSdMajorIncidentsQuerySchema
>
