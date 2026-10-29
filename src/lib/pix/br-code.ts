/**
 * Pix "copia e cola" payload (EMV QRCPS, BR Code). A PSP normally returns a
 * dynamic payload of its own; this builder serves the mock provider and any
 * PSP that only hands back the charge location.
 */

/** CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 upper-case hex digits. */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

function field(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`
}

/** Upper-case ASCII without accents, as the BR Code requires. */
function ascii(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .toUpperCase()
    .slice(0, max)
}

export interface BrCodeInput {
  /** Pix key or, for a dynamic charge, the PSP location. */
  key: string
  /** Amount in reais. */
  amount: number
  merchantName: string
  merchantCity: string
  /** Transaction id: letters and digits, at most 25 characters. */
  txid: string
  /** Free text shown to the payer (kept short: the whole field is <= 99). */
  description?: string
}

export function buildBrCode(input: BrCodeInput): string {
  const account =
    field('00', 'br.gov.bcb.pix') +
    field('01', input.key) +
    (input.description ? field('02', ascii(input.description, 40)) : '')
  const txid = input.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  const body =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    field('54', input.amount.toFixed(2)) +
    field('58', 'BR') +
    field('59', ascii(input.merchantName, 25)) +
    field('60', ascii(input.merchantCity, 15)) +
    field('62', field('05', txid)) +
    '6304'
  return body + crc16(body)
}

/** True when the payload ends with a valid CRC16. */
export function isValidBrCode(payload: string): boolean {
  if (payload.length < 8 || payload.slice(-8, -4) !== '6304') return false
  return crc16(payload.slice(0, -4)) === payload.slice(-4)
}
