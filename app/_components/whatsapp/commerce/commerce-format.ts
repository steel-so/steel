const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatBrl(value: number): string {
  return BRL.format(value)
}

/**
 * Date and time in the zone of the record (never the browser's), so the
 * server render and the client agree and a UTC runner prints the same text.
 */
export function formatInZone(
  iso: string,
  timeZone = 'America/Sao_Paulo',
): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
