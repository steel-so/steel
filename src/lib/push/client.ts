/**
 * Browser-side helpers of Web Push (no React, no server imports), kept apart
 * so they can be unit tested.
 */

export type PushSupport = 'supported' | 'unsupported'

export function pushSupport(
  scope: Pick<Window, 'navigator'> & { PushManager?: unknown } = window,
): PushSupport {
  const hasWorker = 'serviceWorker' in scope.navigator
  const hasPush = typeof scope.PushManager !== 'undefined'
  return hasWorker && hasPush ? 'supported' : 'unsupported'
}

/** VAPID public key (base64url) -> bytes for `applicationServerKey`. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export interface SerializedPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** Shape the API expects, or `null` when the browser gave an incomplete one. */
export function serializePushSubscription(
  subscription: Pick<PushSubscription, 'toJSON'>,
): SerializedPushSubscription | null {
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
  return {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  }
}
