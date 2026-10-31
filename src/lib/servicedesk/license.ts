/**
 * Gestão de licenças de software (S7) — parte pura, sem I/O.
 *
 * Datas de vencimento são datas de calendário (`YYYY-MM-DD`); o "hoje" é
 * calculado no fuso do Brasil, que é o fuso de operação dos workspaces.
 */

export const SD_LICENSE_TIMEZONE = 'America/Sao_Paulo'
/** Vencimentos mais antigos que isso não geram aviso (sem enxurrada na 1ª execução). */
export const SD_LICENSE_EXPIRED_NOTICE_WINDOW_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export type SdLicenseFit = 'UNDER_LICENSED' | 'OVER_LICENSED' | 'COMPLIANT'
export type SdLicenseExpiryState = 'NONE' | 'OK' | 'EXPIRING' | 'EXPIRED'
export type SdLicenseStatus =
  | 'EXPIRED'
  | 'UNDER_LICENSED'
  | 'EXPIRING'
  | 'OVER_LICENSED'
  | 'COMPLIANT'

/** `YYYY-MM-DD` de `at` no fuso informado (fuso inválido cai em UTC). */
export function sdLicenseToday(
  at: Date,
  timeZone: string = SD_LICENSE_TIMEZONE,
): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at)
  } catch {
    return at.toISOString().slice(0, 10)
  }
}

/** Dias entre `today` e o vencimento (negativo = já venceu). */
export function sdLicenseDaysLeft(
  expiresAt: Date | null,
  today: string,
): number | null {
  if (!expiresAt) return null
  const end = Date.parse(`${expiresAt.toISOString().slice(0, 10)}T00:00:00Z`)
  const start = Date.parse(`${today}T00:00:00Z`)
  return Math.round((end - start) / DAY_MS)
}

export function sdLicenseExpiryState(
  daysLeft: number | null,
  noticeDays: number,
): SdLicenseExpiryState {
  if (daysLeft === null) return 'NONE'
  if (daysLeft < 0) return 'EXPIRED'
  if (daysLeft <= noticeDays) return 'EXPIRING'
  return 'OK'
}

export function sdLicenseFit(seats: number, installed: number): SdLicenseFit {
  if (installed > seats) return 'UNDER_LICENSED'
  if (installed < seats) return 'OVER_LICENSED'
  return 'COMPLIANT'
}

/**
 * Situação única mostrada na lista. Vencida vence tudo; depois a falta de
 * licenças (risco de auditoria); depois o vencimento próximo; por fim a sobra.
 */
export function sdLicenseStatus(
  fit: SdLicenseFit,
  expiry: SdLicenseExpiryState,
): SdLicenseStatus {
  if (expiry === 'EXPIRED') return 'EXPIRED'
  if (fit === 'UNDER_LICENSED') return 'UNDER_LICENSED'
  if (expiry === 'EXPIRING') return 'EXPIRING'
  if (fit === 'OVER_LICENSED') return 'OVER_LICENSED'
  return 'COMPLIANT'
}

export interface SdLicenseCompliance {
  installed: number
  seats: number
  /** Positivo = licenças sobrando; negativo = faltando. */
  balance: number
  fit: SdLicenseFit
  expiryState: SdLicenseExpiryState
  daysLeft: number | null
  status: SdLicenseStatus
}

export function computeSdLicenseCompliance(input: {
  seats: number
  installed: number
  expiresAt: Date | null
  renewalNoticeDays: number
  today: string
}): SdLicenseCompliance {
  const daysLeft = sdLicenseDaysLeft(input.expiresAt, input.today)
  const expiryState = sdLicenseExpiryState(daysLeft, input.renewalNoticeDays)
  const fit = sdLicenseFit(input.seats, input.installed)
  return {
    installed: input.installed,
    seats: input.seats,
    balance: input.seats - input.installed,
    fit,
    expiryState,
    daysLeft,
    status: sdLicenseStatus(fit, expiryState),
  }
}

/** Qual aviso a licença merece hoje (nenhum = `null`). */
export function sdLicenseNoticeKind(
  expiryState: SdLicenseExpiryState,
  daysLeft: number | null,
): 'NOTICE' | 'EXPIRED' | null {
  if (expiryState === 'EXPIRING') return 'NOTICE'
  if (
    expiryState === 'EXPIRED' &&
    daysLeft !== null &&
    daysLeft >= -SD_LICENSE_EXPIRED_NOTICE_WINDOW_DAYS
  ) {
    return 'EXPIRED'
  }
  return null
}

/** Escapa `%`/`_` não é preciso no Prisma `contains`; só normaliza o padrão. */
export function normalizeSdLicensePattern(pattern: string): string {
  return pattern.trim().replace(/\s+/g, ' ')
}
