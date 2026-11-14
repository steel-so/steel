import { AI_TOURS } from './definitions/ai'
import { CRM_TOURS } from './definitions/crm'
import { PLATFORM_TOURS } from './definitions/platform'
import { SERVICEDESK_TOURS } from './definitions/servicedesk'
import { ZAP_TOURS } from './definitions/zap'
import type { TourDefinition } from './types'

/** Every guided tour of the app. Each module owns its folder. */
export const TOURS: readonly TourDefinition[] = [
  ...PLATFORM_TOURS,
  ...AI_TOURS,
  ...CRM_TOURS,
  ...ZAP_TOURS,
  ...SERVICEDESK_TOURS,
]

const BY_KEY = new Map(TOURS.map((tour) => [tour.key, tour]))

export function getTour(key: string): TourDefinition | null {
  return BY_KEY.get(key) ?? null
}

export function isKnownTourKey(key: string): boolean {
  return BY_KEY.has(key)
}
