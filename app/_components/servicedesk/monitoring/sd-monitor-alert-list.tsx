'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useSdMonitorAlerts } from '@/src/hooks/use-sd-monitoring'
import {
  formatMonitorDateTime,
  SD_MONITOR_ALERT_STATUS_LABEL,
} from './sd-monitor-format'

/**
 * Alertas de monitoramento ligados a um item da CMDB (aba "Monitoramento" do
 * detalhe do item): o mais recente primeiro, com a origem, quantas vezes o
 * mesmo alerta chegou e o chamado que ele abriu ou em que entrou.
 */
export function SdConfigItemAlerts({
  workspaceId,
  slug,
  configItemId,
}: {
  workspaceId: string
  slug: string
  configItemId: string
}) {
  const { data, isLoading, error } = useSdMonitorAlerts(workspaceId, {
    configItemId,
    limit: 30,
  })

  if (isLoading) return <Skeleton className='h-16 w-full' />
  if (error) {
    return <p className='text-destructive text-sm'>{error.message}</p>
  }
  const alerts = data ?? []
  if (alerts.length === 0) {
    return (
      <div className='flex min-h-48 flex-col items-center justify-center gap-1 py-10 text-center'>
        <p className='font-medium text-sm'>Nenhum alerta recebido</p>
        <p className='max-w-sm text-muted-foreground text-xs'>
          Os alertas do Zabbix, Grafana, PRTG ou de um webhook cujo host casa
          com este item aparecem aqui.
        </p>
      </div>
    )
  }

  return (
    <ul className='divide-y divide-border rounded-lg border border-border'>
      {alerts.map((alert) => (
        <li key={alert.id} className='flex flex-col gap-1 px-3 py-2.5 text-sm'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='min-w-0 flex-1 truncate font-medium'>
              {alert.subject}
            </span>
            <Badge
              variant={alert.status === 'OPEN' ? 'destructive' : 'outline'}
            >
              {SD_MONITOR_ALERT_STATUS_LABEL[alert.status]}
            </Badge>
          </div>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs'>
            <span>{alert.sourceName}</span>
            {alert.severity ? <span>{alert.severity}</span> : null}
            <span>{formatMonitorDateTime(alert.startedAt)}</span>
            {alert.occurrences > 1 ? (
              <span>{alert.occurrences} ocorrências</span>
            ) : null}
            {alert.correlated ? <span>correlacionado</span> : null}
            {alert.suppressed ? <span>em manutenção, sem chamado</span> : null}
            {alert.ticket ? (
              <Link
                href={`/${slug}/servicedesk/tickets/${alert.ticket.number}`}
                className='text-foreground underline-offset-2 hover:underline'
              >
                Chamado #{alert.ticket.number}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
