import type { ModuleKind } from '@prisma/client'
import type { ApiScope } from '@/src/lib/api/session'
import type { CrmPipelineDTO, CrmPipelineStageDTO } from '@/types/crm-pipeline'
import type { SdPhaseDTO } from '@/types/sd-config'

/**
 * DTOs that exist only in the public API v1 (ADR 0035). Everything else the
 * v1 routes return is the app's own DTO, unchanged.
 */

/** `GET /api/v1/me` — `steel whoami`. */
export interface ApiV1MeDTO {
  user: { id: string; name: string; email: string }
  workspace: { id: string; slug: string; name: string }
  /** Membership role in the workspace (`OWNER`, `ADMIN`, `MEMBER`...). */
  role: string
  scopes: ApiScope[]
  modules: ModuleKind[]
  token: { id: string; expiresAt: string }
}

/** `GET /api/v1/crm/pipelines` — a pipeline with its stages, in order. */
export interface ApiV1CrmPipelineDTO extends CrmPipelineDTO {
  stages: CrmPipelineStageDTO[]
}

export interface ApiV1LeadImportErrorDTO {
  /** Line in the CSV (the header is line 1). */
  row: number
  code: string
  message: string
}

/** `POST /api/v1/crm/leads/import`. */
export interface ApiV1LeadImportResultDTO {
  /** Data rows read from the CSV. */
  total: number
  created: number
  /** Rows matching an open lead by e-mail or phone (not duplicated). */
  skipped: number
  errors: ApiV1LeadImportErrorDTO[]
}

/**
 * `GET /api/v1/servicedesk/phases` — an active phase with where a ticket in
 * it may go next (`steel sd ticket move`).
 */
export interface ApiV1SdPhaseDTO extends SdPhaseDTO {
  /**
   * Active phases of the same type a ticket may move to from this one.
   * `null` = the type has no transition rules (free flow: any active phase
   * of the type). Department limits are checked on the move itself.
   */
  nextPhaseIds: string[] | null
}
