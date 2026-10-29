import z from 'zod'
import { SD_SWARM_MAX_MEMBERS } from '@/src/lib/servicedesk/swarm'

const UserIds = z
  .array(z.string().min(1).max(64))
  .min(1)
  .max(SD_SWARM_MAX_MEMBERS)

export const StartSdSwarmSchema = z.object({
  /** Why the specialists are needed; the invitees read it. */
  reason: z.string().trim().min(3).max(1000),
  userIds: UserIds,
  /** Also opens a temporary private Slack channel (needs the Slack app). */
  openSlackChannel: z.boolean().default(false),
})

export const InviteSdSwarmSchema = z.object({ userIds: UserIds })

export const RespondSdSwarmSchema = z.object({
  response: z.enum(['JOIN', 'DECLINE']),
})

export const CloseSdSwarmSchema = z.object({
  /** What was decided; goes into the ticket history. */
  outcome: z.string().trim().max(2000).optional(),
})

export type StartSdSwarmInput = z.infer<typeof StartSdSwarmSchema>
export type InviteSdSwarmInput = z.infer<typeof InviteSdSwarmSchema>
export type RespondSdSwarmInput = z.infer<typeof RespondSdSwarmSchema>
export type CloseSdSwarmInput = z.infer<typeof CloseSdSwarmSchema>
