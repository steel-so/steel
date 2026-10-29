/**
 * Senders a CRM campaign may use (ADR 0055): any address on a VERIFIED
 * sending domain of the workspace, or on the platform domain.
 */
export interface CrmEmailSenderOptionsDTO {
  /** Steel's mail domain, usable without a domain of one's own. */
  platformDomain: string
  /** Names of the workspace's VERIFIED sending domains, sorted. */
  verifiedDomains: string[]
}
