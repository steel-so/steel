import { SD_STATE_TONE } from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import type {
  SdLicenseExpiryStateDTO,
  SdLicenseStatusDTO,
} from '@/types/sd-license'

export const SD_LICENSE_STATUS_LABEL: Record<SdLicenseStatusDTO, string> = {
  COMPLIANT: 'Em conformidade',
  UNDER_LICENSED: 'Faltam licenças',
  OVER_LICENSED: 'Licenças sobrando',
  EXPIRING: 'Perto de vencer',
  EXPIRED: 'Vencida',
}

export const SD_LICENSE_STATUS_TONE: Record<SdLicenseStatusDTO, string> = {
  COMPLIANT: SD_STATE_TONE.ok,
  UNDER_LICENSED: SD_STATE_TONE.bad,
  OVER_LICENSED: SD_STATE_TONE.neutral,
  EXPIRING: SD_STATE_TONE.warn,
  EXPIRED: SD_STATE_TONE.bad,
}

export const SD_LICENSE_STATUS_OPTIONS = (
  Object.keys(SD_LICENSE_STATUS_LABEL) as SdLicenseStatusDTO[]
).map((value) => ({ value, label: SD_LICENSE_STATUS_LABEL[value] }))

/** Texto curto do vencimento ("Vence em 12 dias", "Venceu há 3 dias"). */
export function sdLicenseExpiryText(
  state: SdLicenseExpiryStateDTO,
  daysLeft: number | null,
): string {
  if (state === 'NONE' || daysLeft === null) return 'Sem vencimento'
  if (daysLeft < 0) {
    const days = -daysLeft
    return `Venceu há ${days} dia${days === 1 ? '' : 's'}`
  }
  if (daysLeft === 0) return 'Vence hoje'
  return `Vence em ${daysLeft} dia${daysLeft === 1 ? '' : 's'}`
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatSdLicenseCents(cents: number | null): string {
  return cents === null ? '—' : BRL.format(cents / 100)
}

/** Saldo com sinal: "+3 sobrando", "-2 faltando". */
export function sdLicenseBalanceText(balance: number): string {
  if (balance === 0) return 'Exato'
  return balance > 0 ? `${balance} sobrando` : `${-balance} faltando`
}
