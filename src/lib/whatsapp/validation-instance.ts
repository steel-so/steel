import {
  ZAPI_VALIDATION_CLIENT_TOKEN,
  ZAPI_VALIDATION_INSTANCE_ID,
  ZAPI_VALIDATION_TOKEN,
} from '@/lib/env/server'
import type { ZapiCredentials } from './zapi-client'

/**
 * `WhatsAppNumberValidation.connectionId` of a run that used the platform
 * instance (there is no connection row for it).
 */
export const PLATFORM_VALIDATION_CONNECTION_ID = 'platform'

/**
 * Credentials of the platform-level Z-API instance used for the "has
 * WhatsApp?" check, or null when it is not configured (feature inert).
 * Never serialize the result into a response or a log.
 */
export function getPlatformZapiCredentials(): ZapiCredentials | null {
  if (!ZAPI_VALIDATION_INSTANCE_ID || !ZAPI_VALIDATION_TOKEN) return null
  return {
    instanceId: ZAPI_VALIDATION_INSTANCE_ID,
    token: ZAPI_VALIDATION_TOKEN,
    clientToken: ZAPI_VALIDATION_CLIENT_TOKEN,
  }
}

export function isPlatformValidationConfigured(): boolean {
  return getPlatformZapiCredentials() !== null
}
