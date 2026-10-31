export type CrmHealthLevelDTO = 'LOW' | 'MEDIUM' | 'HIGH'

/** A factor that scored: "Sem interação recente - Última interação há 52 dias". */
export interface CrmHealthFactorDTO {
  key: string
  label: string
  /** Points it added to the risk. */
  points: number
  /** The most it could add. */
  max: number
  detail: string
}

export interface CrmHealthNextActionDTO {
  key: string
  label: string
  detail: string
}

interface CrmHealthBaseDTO {
  /** 0-100, higher = more risk (same scale as the ServiceDesk risk). */
  riskScore: number
  level: CrmHealthLevelDTO
  levelLabel: string
  factors: CrmHealthFactorDTO[]
  nextAction: CrmHealthNextActionDTO
  /** Risk change since the previous computation (+ = got worse); null = first. */
  riskDelta: number | null
  computedAt: string
}

/** T4: churn risk of a company. `healthScore` is `100 - riskScore`. */
export interface CrmCustomerHealthDTO extends CrmHealthBaseDTO {
  companyId: string
  companyName: string
  healthScore: number
  /** Factors skipped for lack of data (no WhatsApp, no ServiceDesk match). */
  missing: string[]
}

/** C4: risk of an open deal. */
export interface CrmOpportunityHealthDTO extends CrmHealthBaseDTO {
  opportunityId: string
  opportunityName: string
}
