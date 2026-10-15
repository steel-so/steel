/** Formatação pt-BR dos números do kit de Vendas (sem fuso: só números). */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
})

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const INTEGER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const ONE_DECIMAL = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 1,
})

/** `R$ 18.400` — ou `R$ 1,2 mi` com `compact` (acima de R$ 100 mil). */
export function formatBrl(value: number, compact = false): string {
  if (compact && Math.abs(value) >= 100_000) {
    return BRL_COMPACT.format(value).replace(/\s/g, ' ')
  }
  return BRL.format(value).replace(/\s/g, ' ')
}

export function formatInt(value: number): string {
  return INTEGER.format(value)
}

/** `72%` / `7,5%` — `—` quando não há base. */
export function formatPct(value: number | null): string {
  return value === null ? '—' : `${ONE_DECIMAL.format(value)}%`
}

/** `12 dias` / `1 dia` / `—`. */
export function formatDays(value: number | null): string {
  if (value === null) return '—'
  const rounded = ONE_DECIMAL.format(value)
  return `${rounded} ${value === 1 ? 'dia' : 'dias'}`
}

/** Variação com sinal: `+12,5%` / `−3%`. */
export function formatChange(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${ONE_DECIMAL.format(Math.abs(value))}%`
}

/** Iniciais para o avatar sem foto ("Ana Souza" → "AS"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" (relativo a `now`). */
export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000),
  )
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`
}

/** Primeiro nome, para frases curtas da TV ("Ana fechou…"). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}
