import 'server-only'
import {
  VAPID_PRIVATE_KEY,
  VAPID_PUBLIC_KEY,
  VAPID_SUBJECT,
} from '@/lib/env/server'
import type { VapidKeys } from './web-push'

const DEFAULT_SUBJECT = 'mailto:ti@stratustelecom.com.br'

/** VAPID keys from the environment, or `null` (push OFF and inert). */
export function getVapidKeys(): VapidKeys | null {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT ?? DEFAULT_SUBJECT,
  }
}

export function isPushConfigured(): boolean {
  return getVapidKeys() !== null
}
