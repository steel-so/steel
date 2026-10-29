'use client'

import { useId, useState } from 'react'
import { SdConfigItemPicker } from '@/app/_components/servicedesk/pickers'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import {
  useLinkSdMonitorAlert,
  useSdMonitorAlerts,
} from '@/src/hooks/use-sd-monitoring'
import type { SdMonitorAlertDTO } from '@/types/sd-monitor'
import { formatMonitorDateTime } from './sd-monitor-format'

interface HostGroup {
  host: string
  alerts: SdMonitorAlertDTO[]
}

/**
 * Agrupa por host (sem diferenciar maiúsculas). Alerta sem host, ou que já
 * tem item da CMDB, não entra.
 */
export function groupUnmatchedByHost(alerts: SdMonitorAlertDTO[]): HostGroup[] {
  const groups = new Map<string, HostGroup>()
  for (const alert of alerts) {
    if (!alert.host || alert.configItem) continue
    const key = alert.host.toLowerCase()
    const group = groups.get(key)
    if (group) group.alerts.push(alert)
    else groups.set(key, { host: alert.host, alerts: [alert] })
  }
  return [...groups.values()]
}

function HostRow({
  workspaceId,
  group,
  canEdit,
}: {
  workspaceId: string
  group: HostGroup
  canEdit: boolean
}) {
  const link = useLinkSdMonitorAlert(workspaceId)
  const [itemId, setItemId] = useState<string | null>(null)
  const [remember, setRemember] = useState(true)
  const latest = group.alerts[0]
  const rememberId = useId()

  async function save() {
    if (!itemId) return
    try {
      await link.mutateAsync({
        alertId: latest.id,
        data: { configItemId: itemId, remember },
      })
      notify.success('Host ligado ao item da CMDB')
    } catch (err) {
      notify.error(err)
    }
  }

  return (
    <li className='flex flex-col gap-2 rounded-lg border border-border p-3'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <span className='font-medium text-sm'>{group.host}</span>
        <span className='text-muted-foreground text-xs'>
          {group.alerts.length}{' '}
          {group.alerts.length === 1 ? 'alerta' : 'alertas'} · último em{' '}
          {formatMonitorDateTime(latest.startedAt)}
        </span>
      </div>
      <p className='truncate text-muted-foreground text-xs'>{latest.subject}</p>
      {canEdit ? (
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='min-w-0 flex-1'>
            <SdConfigItemPicker
              workspaceId={workspaceId}
              value={itemId}
              onChange={(option) => setItemId(option?.id ?? null)}
              allowCreate={false}
              placeholder='Ligar a um item da CMDB…'
            />
          </div>
          <div className='flex items-center gap-2 text-xs'>
            <Checkbox
              id={rememberId}
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <Label htmlFor={rememberId} className='text-xs'>
              Lembrar este host
            </Label>
          </div>
          <Button
            size='sm'
            disabled={!itemId || link.isPending}
            onClick={() => void save()}
          >
            {link.isPending ? 'Ligando...' : 'Ligar'}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Hosts de alertas que não casaram com nenhum item da CMDB. Ligar um deles
 * guarda o apelido (host → item): os próximos alertas já entram vinculados e
 * os abertos de agora com o mesmo host também.
 */
export function SdMonitorUnmatchedPanel({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data } = useSdMonitorAlerts(workspaceId, {
    unmatched: true,
    limit: 100,
  })
  const groups = groupUnmatchedByHost(data ?? [])
  if (groups.length === 0) return null

  return (
    <section
      aria-label='Hosts sem item na CMDB'
      className='flex flex-col gap-2 border-border border-t pt-4'
    >
      <div className='flex flex-col gap-0.5'>
        <h3 className='font-medium text-sm'>Hosts sem item na CMDB</h3>
        <p className='text-muted-foreground text-xs'>
          O nome do host destes alertas não bate com nenhum item (nome, código
          ou IP). Ligue à mão e o Steel lembra para os próximos.
        </p>
      </div>
      <ul className='flex flex-col gap-2'>
        {groups.map((group) => (
          <HostRow
            key={group.host.toLowerCase()}
            workspaceId={workspaceId}
            group={group}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </section>
  )
}
