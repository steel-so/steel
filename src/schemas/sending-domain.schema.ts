import z from 'zod'

/**
 * Sending domains (ADR 0054): the workspace registers its own domain in
 * Resend, publishes the DNS records and, once VERIFIED, sends newsletters
 * from any address on it. OWNER/ADMIN manage them in Ajustes.
 */

export const SENDING_DOMAIN_STATUSES = [
  'NOT_STARTED',
  'PENDING',
  'VERIFIED',
  'FAILED',
  'TEMPORARY_FAILURE',
] as const
export type SendingDomainStatusValue = (typeof SENDING_DOMAIN_STATUSES)[number]

/** Resend regions; São Paulo is the default for Brazilian customers. */
export const SENDING_DOMAIN_REGIONS = [
  'sa-east-1',
  'us-east-1',
  'eu-west-1',
  'ap-northeast-1',
] as const

/**
 * Domains nobody can register as their own: free mailbox providers and our
 * own mail domain. The service also rejects bare public suffixes.
 */
export const BLOCKED_SENDING_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'aol.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'proton.me',
  'protonmail.com',
  'stratustelecom.com.br',
])

const FQDN = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/

export const SendingDomainNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
  .pipe(
    z
      .string()
      .regex(FQDN, 'Informe um domínio válido, como news.suaempresa.com.br')
      .refine((value) => !BLOCKED_SENDING_DOMAINS.has(value), {
        message:
          'Use um domínio próprio da empresa (não vale Gmail, Outlook e afins)',
      }),
  )
  .meta({
    description:
      'Domínio (ou subdomínio) da empresa. Recomendado um subdomínio dedicado, como `news.suaempresa.com.br`.',
    example: 'news.acme.com.br',
  })

export const CreateSendingDomainSchema = z.object({
  name: SendingDomainNameSchema,
  region: z.enum(SENDING_DOMAIN_REGIONS).default('sa-east-1'),
})

export type CreateSendingDomainDTO = z.infer<typeof CreateSendingDomainSchema>

/** One DNS record as Resend returns it (stored in `records`). */
export const SendingDomainRecordSchema = z.object({
  /** SPF | DKIM | DMARC | Tracking | Receiving… */
  record: z.string(),
  type: z.string(),
  name: z.string(),
  value: z.string(),
  ttl: z.string().optional(),
  priority: z.number().optional(),
  status: z.string(),
})

export type SendingDomainRecord = z.infer<typeof SendingDomainRecordSchema>

export type SendingDomainDTO = {
  id: string
  name: string
  status: SendingDomainStatusValue
  region: string
  records: SendingDomainRecord[]
  failureReason: string | null
  lastCheckedAt: string | null
  verifiedAt: string | null
  /** Active newsletters sending from this domain. */
  newslettersCount: number
  createdAt: string
  /**
   * DMARC of the registrable domain (detail only — the list leaves it out).
   * `found: null` means the lookup failed or timed out (unknown).
   */
  dmarc?: SendingDomainDmarcDTO
}

export const SUGGESTED_DMARC_VALUE = 'v=DMARC1; p=none;'

export type SendingDomainDmarcDTO = {
  /** Where the TXT record lives, e.g. `_dmarc.acme.com.br`. */
  name: string
  found: boolean | null
  /** The DMARC TXT value when found. */
  value: string | null
  suggested: string
}
