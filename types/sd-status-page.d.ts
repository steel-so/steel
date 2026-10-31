import type {
  SdMajorIncidentImpactDTO,
  SdMajorIncidentStatusDTO,
  SdStatusChannelDTO,
  SdStatusPageOverallDTO,
} from './sd-major-incident'
import type {
  SdPublicMaintenanceDTO,
  SdPublicStatusComponentDTO,
} from './sd-status-maintenance'

export interface SdStatusPageDTO {
  id: string
  name: string
  slug: string
  /** `/status-page/<slug>`. */
  path: string
  description: string | null
  customer: { id: string; name: string } | null
  serviceIds: string[]
  services: { id: string; name: string }[]
  published: boolean
  allowSubscriptions: boolean
  subscriberCount: number
  activeIncidentCount: number
  createdAt: string
}

export interface SdStatusPageListDTO {
  items: SdStatusPageDTO[]
}

export interface SdStatusSubscriberDTO {
  id: string
  channel: SdStatusChannelDTO
  address: string
  name: string | null
  confirmed: boolean
  createdAt: string
}

export interface SdStatusSubscriberListDTO {
  items: SdStatusSubscriberDTO[]
}

export interface SdPublicStatusUpdateDTO {
  status: SdMajorIncidentStatusDTO
  message: string
  at: string
}

export interface SdPublicStatusIncidentDTO {
  id: string
  title: string
  summary: string | null
  impact: SdMajorIncidentImpactDTO
  status: SdMajorIncidentStatusDTO
  startedAt: string
  resolvedAt: string | null
  /** Newest first. */
  updates: SdPublicStatusUpdateDTO[]
}

/** The public page (no session): customer-safe fields only. */
export interface SdPublicStatusPageDTO {
  name: string
  description: string | null
  workspaceName: string
  timeZone: string
  overall: SdStatusPageOverallDTO
  services: string[]
  /** Services with their own state, set by the agents. */
  components: SdPublicStatusComponentDTO[]
  /** Scheduled and running maintenance windows (soonest first). */
  maintenances: SdPublicMaintenanceDTO[]
  allowSubscriptions: boolean
  active: SdPublicStatusIncidentDTO[]
  /** Resolved in the last 30 days, newest first. */
  recent: SdPublicStatusIncidentDTO[]
}

export interface SdStatusSubscriptionDTO {
  pageName: string
  pageSlug: string
  channel: SdStatusChannelDTO
  /** Masked address (`j***@acme.com`). */
  addressMasked: string
  confirmed: boolean
  unsubscribed: boolean
}
