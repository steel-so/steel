export type SdStatusComponentStateDTO = 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE'
export type SdMaintenancePhaseDTO =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'CANCELED'

export interface SdStatusComponentDTO {
  id: string
  pageId: string
  name: string
  /** Catalog service it mirrors, when it mirrors one. */
  serviceId: string | null
  state: SdStatusComponentStateDTO
  position: number
  stateChangedAt: string
}

export interface SdStatusComponentListDTO {
  items: SdStatusComponentDTO[]
}

export interface SdStatusMaintenanceDTO {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  phase: SdMaintenancePhaseDTO
  /** Monitoring alerts about the covered CMDB items open no ticket meanwhile. */
  suppressMonitoring: boolean
  configItems: { id: string; name: string }[]
  pages: { id: string; name: string; slug: string }[]
  notifySubscribers: boolean
  announcedAt: string | null
  canceledAt: string | null
  /** Delivery of the notice (done = claimed by the job). */
  notify: { done: boolean; total: number; sent: number; failed: number }
  createdAt: string
}

export interface SdStatusMaintenanceListDTO {
  items: SdStatusMaintenanceDTO[]
}

/** Public view (no session): customer-safe fields only. */
export interface SdPublicStatusComponentDTO {
  name: string
  state: SdStatusComponentStateDTO
}

export interface SdPublicMaintenanceDTO {
  id: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  inProgress: boolean
}
