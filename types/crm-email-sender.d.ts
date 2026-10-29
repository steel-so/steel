/**
 * Senders a CRM campaign may use (ADR 0055): any address on a VERIFIED
 * sending domain of the workspace, or the platform address.
 */
export interface CrmEmailSenderOptionsDTO {
  /** Platform address usable without a domain of one's own. */
  platformAddress: string
  /** Names of the workspace's VERIFIED sending domains, sorted. */
  verifiedDomains: string[]
}
