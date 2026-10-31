export interface PushStatusDTO {
  /** Server has VAPID keys; false = push is OFF. */
  enabled: boolean
  /** VAPID public key for `pushManager.subscribe` (null when disabled). */
  publicKey: string | null
  /** Devices of the caller registered for push. */
  devices: number
}
