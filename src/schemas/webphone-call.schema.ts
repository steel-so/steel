import { z } from 'zod'

/** The browser phone starts tracking a call (ADR 0044 addendum). */
export const WebphoneCallBeginSchema = z.object({
  direction: z.enum(['in', 'out']),
  /** Remote number as the phone knows it (dialed, or caller id). */
  number: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120).nullish(),
  /** Conversation the call was placed from, when the UI knows it. */
  conversationId: z.string().trim().min(1).max(40).optional(),
  /** Asterisk unique id, when the PABX sends it on the INVITE. */
  pabxUniqueId: z.string().trim().min(1).max(40).optional(),
})

export type WebphoneCallBeginDTO = z.infer<typeof WebphoneCallBeginSchema>

/** How a call the browser saw ended without being answered. */
export const WEBPHONE_CALL_OUTCOMES = [
  'completed',
  'busy',
  'missed',
  'declined',
  'canceled',
  'failed',
] as const

/** Lifecycle step the browser reports for a tracked call. */
export const WebphoneCallReportSchema = z.object({
  event: z.enum(['answered', 'ended']),
  outcome: z.enum(WEBPHONE_CALL_OUTCOMES).optional(),
})

export type WebphoneCallReportDTO = z.infer<typeof WebphoneCallReportSchema>
