import { randomBytes } from 'node:crypto'

/** 32 letters and digits: a valid Pix txid (26 to 35 characters). */
export function newChargeTxid(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Digitable line of a TEST boleto (47 digits in the usual 5-5 / 5-6 / 5-6 / 1 /
 * 14 grouping). It starts with the bank code `999`, which does not exist, and
 * its check digits are not real: no bank can settle it. Deterministic for a
 * txid so a retry shows the same line.
 */
export function buildMockBoletoLine(txid: string, amount: number): string {
  const digits = [...txid.toLowerCase()]
    .map((char) => Number.parseInt(char, 16) % 10)
    .filter((n) => !Number.isNaN(n))
  const padded = `999${digits.join('')}`.padEnd(33, '0').slice(0, 33)
  const cents = Math.max(0, Math.round(amount * 100))
  const value = String(cents).padStart(10, '0').slice(-10)
  const tail = `0000${value}`
  return [
    `${padded.slice(0, 5)}.${padded.slice(5, 10)}`,
    `${padded.slice(10, 15)}.${padded.slice(15, 21)}`,
    `${padded.slice(21, 26)}.${padded.slice(26, 32)}`,
    padded.slice(32, 33),
    tail,
  ].join(' ')
}

/** Amount in reais as shown to people ("R$ 1.234,50"). */
export function formatChargeAmount(amount: number): string {
  return amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}
