/**
 * Meta's customer service window: free-form messages are only accepted for
 * 24 hours after the contact's last message; after that only an approved
 * template goes through. Z-API (unofficial) has no such window.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface ServiceWindowState {
  /** `true` when free-form messages are accepted right now. */
  open: boolean
  /** When the window closes; `null` if the contact never wrote. */
  closesAt: Date | null
}

export function serviceWindowState(
  lastInboundAt: string | null | undefined,
  now: number = Date.now(),
): ServiceWindowState {
  if (!lastInboundAt) return { open: false, closesAt: null }
  const last = new Date(lastInboundAt).getTime()
  if (Number.isNaN(last)) return { open: false, closesAt: null }
  const closesAt = new Date(last + SERVICE_WINDOW_MS)
  return { open: now < closesAt.getTime(), closesAt }
}
