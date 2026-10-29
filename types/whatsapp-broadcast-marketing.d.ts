/** Marketing Messages Lite metrics of a broadcast (Z11). */
export interface WhatsAppBroadcastMarketingMetricsDTO {
  /** The workspace setting is on right now. */
  enabled: boolean
  /** Recipients actually sent through the Lite API. */
  viaMarketingLiteCount: number
  /** Meta totals for the template in the broadcast period; null when the
   * broadcast didn't use the Lite API or Meta couldn't be reached. */
  analytics: {
    sent: number
    delivered: number
    read: number
    clicked: number
  } | null
  /** Why `analytics` is null, in Portuguese for the screen. */
  unavailableReason: string | null
}
