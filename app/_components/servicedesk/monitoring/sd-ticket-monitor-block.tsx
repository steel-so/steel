'use client'

import { RadarIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSdMonitorAlerts } from '@/src/hooks/use-sd-monitoring'
import type { SdMonitorAlertDTO } from '@/types/sd-monitor'
import type { SdTicketDTO } from '@/types/sd-ticket'

const STATUS_LABEL: Record<SdMonitorAlertDTO['status'], string> = {
  OPEN: 'Alerta aberto',
  RESOLVED: 'Alerta normalizado',
  IGNORED: 'Alerta ignorado',
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className='grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-2'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span className='min-w-0 break-words text-xs'>{value}</span>
    </div>
  )
}

/**
 * Bloco de origem do chamado aberto pelo monitoramento: só aparece quando o
 * chamado veio do canal `API` e existe um alerta vinculado. Lê
 * `GET /servicedesk/monitor-alerts?ticketId=` (só agentes), então para o
 * solicitante o bloco simplesmente não renderiza.
 */
export function SdTicketMonitorBlock({
  workspaceId,
  ticket,
  className,
}: {
  workspaceId: string
  ticket: SdTicketDTO
  /** Ajuste de moldura (a tela do chamado usa sem borda). */
  className?: string
}) {
  const { data } = useSdMonitorAlerts(
    workspaceId,
    { ticketId: ticket.id, limit: 20 },
    { enabled: ticket.channel === 'API' },
  )
  // A raiz é o alerta que abriu o chamado; os demais entraram por correlação.
  const alert = data?.find((a) => !a.correlated) ?? data?.[0]
  if (!alert) return null
  const correlated = (data ?? []).filter((a) => a.id !== alert.id)

  return (
    <section
      aria-label='Alerta de monitoramento'
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-3',
        className,
      )}
    >
      <header className='flex items-center justify-between gap-2'>
        <span className='flex items-center gap-1.5 font-medium text-sm'>
          <SteelIcon icon={RadarIcon} strokeWidth={2} />
          Monitoramento
        </span>
        <Badge variant={alert.status === 'OPEN' ? 'destructive' : 'outline'}>
          {STATUS_LABEL[alert.status]}
        </Badge>
      </header>
      <p className='text-xs'>{alert.subject}</p>
      <div className='flex flex-col gap-1'>
        <Row label='Origem' value={alert.sourceName} />
        {alert.host ? <Row label='Host' value={alert.host} /> : null}
        {alert.configItem ? (
          <Row label='Item de CI' value={alert.configItem.name} />
        ) : null}
        {alert.severity ? (
          <Row label='Severidade' value={alert.severity} />
        ) : null}
        <Row label='Evento' value={alert.externalId} />
        {alert.occurrences > 1 ? (
          <Row label='Recebido' value={`${alert.occurrences} vezes`} />
        ) : null}
        <Row
          label='Disparou'
          value={DATE_TIME.format(new Date(alert.startedAt))}
        />
        {alert.resolvedAt ? (
          <Row
            label='Normalizou'
            value={DATE_TIME.format(new Date(alert.resolvedAt))}
          />
        ) : null}
      </div>
      {correlated.length > 0 ? (
        <div className='flex flex-col gap-1.5 border-border border-t pt-2'>
          <span className='font-medium text-muted-foreground text-xs'>
            Alertas correlacionados ({correlated.length})
          </span>
          <ul className='flex flex-col gap-1.5'>
            {correlated.map((item) => (
              <li
                key={item.id}
                className='flex items-start justify-between gap-2 text-xs'
              >
                <span className='min-w-0 break-words'>
                  {item.subject}
                  {item.severity ? (
                    <span className='text-muted-foreground'>
                      {' '}
                      · {item.severity}
                    </span>
                  ) : null}
                </span>
                <Badge
                  variant={item.status === 'OPEN' ? 'destructive' : 'outline'}
                >
                  {item.status === 'OPEN' ? 'Aberto' : 'Normalizado'}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
