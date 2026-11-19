'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useAdminServer } from '@/src/hooks/use-admin-server'
import {
  type ContainerAlert,
  containerAlert,
  DISK_ALERT_PERCENT,
  MEMORY_ALERT_PERCENT,
} from '@/src/lib/server-stats/thresholds'
import type { AdminServerDTO, ServerContainerDTO } from '@/types/admin-server'
import {
  AdminPanel,
  DENSE_TABLE,
  EmptyState,
  ErrorState,
  formatBytes,
  StatTile,
  StatusPill,
  TableSkeleton,
} from '../shell/admin-ui'
import { ServerSparkline } from './server-sparkline'

/** Points kept per series (5 s polling → 5 minutes). */
export const HISTORY_POINTS = 60

type Series = 'cpu' | 'mem' | 'load' | 'rx' | 'tx'
type History = Record<Series, number[]>
const EMPTY_HISTORY: History = { cpu: [], mem: [], load: [], rx: [], tx: [] }

const push = (arr: number[], v: number | null | undefined) =>
  v === null || v === undefined ? arr : [...arr, v].slice(-HISTORY_POINTS)

/** Folds a snapshot into the in-memory histories. */
export function appendHistory(h: History, s: AdminServerDTO): History {
  return {
    cpu: push(h.cpu, s.host.cpuPercent),
    mem: push(h.mem, s.host.memory?.percent),
    load: push(h.load, s.host.loadAvg?.[0]),
    rx: push(h.rx, s.host.network?.rxBytesPerSec),
    tx: push(h.tx, s.host.network?.txBytesPerSec),
  }
}

const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`)

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

const rate = (bytesPerSec: number) => `${formatBytes(bytesPerSec)}/s`

const ALERT_LABEL: Record<ContainerAlert, string> = {
  stopped: 'Parado',
  unhealthy: 'Unhealthy',
  restarting: 'Reiniciando',
}

function ContainerState({ c }: { c: ServerContainerDTO }) {
  const alert = containerAlert(c)
  if (alert) return <StatusPill tone='bad'>{ALERT_LABEL[alert]}</StatusPill>
  if (c.state === 'running') {
    return (
      <StatusPill tone={c.health === 'starting' ? 'warn' : 'ok'}>
        {c.health === 'starting' ? 'Iniciando' : 'Rodando'}
      </StatusPill>
    )
  }
  return <StatusPill tone='muted'>{c.state}</StatusPill>
}

function MeterTile({
  label,
  percent,
  alertAt,
  hint,
  history,
}: {
  label: string
  percent: number | null
  alertAt: number
  hint?: string
  history?: number[]
}) {
  const over = percent !== null && percent > alertAt
  return (
    <div className='min-w-0'>
      <StatTile
        label={label}
        value={pct(percent)}
        tone={over ? 'danger' : 'default'}
        hint={over ? `Acima de ${alertAt}% — ${hint ?? ''}` : hint}
      />
      {history && (
        <ServerSparkline
          values={history}
          max={100}
          label={`Histórico de ${label}`}
          color={over ? '#dc2626' : '#6366f1'}
        />
      )}
    </div>
  )
}

function HostSection({
  host,
  history,
}: {
  host: AdminServerDTO['host']
  history: History
}) {
  return (
    <div className='space-y-3'>
      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <MeterTile
          label='CPU'
          percent={host.cpuPercent}
          alertAt={100}
          hint={`${host.cpuCount} núcleos`}
          history={history.cpu}
        />
        <MeterTile
          label='Memória'
          percent={host.memory?.percent ?? null}
          alertAt={MEMORY_ALERT_PERCENT}
          hint={
            host.memory
              ? `${formatBytes(host.memory.usedBytes)} de ${formatBytes(host.memory.totalBytes)}`
              : undefined
          }
          history={history.mem}
        />
        <MeterTile
          label='Disco'
          percent={host.disk?.percent ?? null}
          alertAt={DISK_ALERT_PERCENT}
          hint={
            host.disk
              ? `${formatBytes(host.disk.freeBytes)} livres de ${formatBytes(host.disk.totalBytes)}`
              : undefined
          }
        />
        <div className='min-w-0'>
          <StatTile
            label='Load (1 / 5 / 15 min)'
            value={host.loadAvg ? host.loadAvg[0].toFixed(2) : '—'}
            hint={
              host.loadAvg
                ? `${host.loadAvg[1].toFixed(2)} · ${host.loadAvg[2].toFixed(2)}`
                : undefined
            }
          />
          <ServerSparkline values={history.load} label='Histórico de load' />
        </div>
      </div>

      <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
        <StatTile
          label='Uptime do host'
          value={formatUptime(host.uptimeSeconds)}
          hint={host.platform}
        />
        <StatTile
          label='Réplica consultada'
          value={host.hostname}
          hint='cada atualização pode cair em outra réplica'
        />
        <div className='min-w-0'>
          <StatTile
            label='Rede ↓ (rx)'
            value={host.network ? rate(host.network.rxBytesPerSec) : '—'}
            hint={
              host.network
                ? `${formatBytes(host.network.rxBytes)} desde o boot do container`
                : undefined
            }
          />
          <ServerSparkline
            values={history.rx}
            label='Histórico de rede recebida'
            color='#0d9488'
          />
        </div>
        <div className='min-w-0'>
          <StatTile
            label='Rede ↑ (tx)'
            value={host.network ? rate(host.network.txBytesPerSec) : '—'}
            hint={
              host.network
                ? `${formatBytes(host.network.txBytes)} desde o boot do container`
                : undefined
            }
          />
          <ServerSparkline
            values={history.tx}
            label='Histórico de rede enviada'
            color='#d97706'
          />
        </div>
      </div>
    </div>
  )
}

function ContainersTable({ docker }: { docker: AdminServerDTO['docker'] }) {
  if (!docker.available) {
    return (
      <EmptyState
        title='Containers indisponíveis'
        description={docker.reason ?? undefined}
      />
    )
  }
  if (docker.containers.length === 0) {
    return <EmptyState title='Nenhum container encontrado' />
  }
  return (
    <div className='overflow-x-auto'>
      <Table className={DENSE_TABLE}>
        <TableHeader>
          <TableRow>
            <TableHead>Container</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className='text-right'>CPU</TableHead>
            <TableHead className='text-right'>Memória</TableHead>
            <TableHead className='text-right'>Reinícios</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docker.containers.map((c) => {
            const alert = containerAlert(c)
            return (
              <TableRow key={c.id} className={cn(alert && 'bg-destructive/5')}>
                <TableCell>
                  <p className='font-medium'>{c.name}</p>
                  <p className='max-w-64 truncate font-mono text-[11px] text-muted-foreground'>
                    {c.image}
                  </p>
                </TableCell>
                <TableCell>
                  <ContainerState c={c} />
                </TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {pct(c.cpuPercent)}
                </TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {c.memUsageBytes === null
                    ? '—'
                    : `${formatBytes(c.memUsageBytes)} (${pct(c.memPercent)})`}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-mono tabular-nums',
                    c.restartCount > 0 && 'text-amber-600 dark:text-amber-400',
                  )}
                >
                  {c.restartCount}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {c.status}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function ServicesSection({ data }: { data: AdminServerDTO }) {
  const { postgres, redis } = data
  return (
    <div className='grid gap-4 md:grid-cols-2'>
      <AdminPanel
        title='PostgreSQL'
        actions={
          <StatusPill tone={postgres.ok ? 'ok' : 'bad'}>
            {postgres.ok ? 'Online' : 'Falhou'}
          </StatusPill>
        }
      >
        {postgres.ok ? (
          <dl className='grid grid-cols-3 gap-3 text-sm'>
            <Metric label='Latência' value={`${postgres.latencyMs} ms`} />
            <Metric
              label='Conexões'
              value={`${postgres.connections} / ${postgres.maxConnections}`}
            />
            <Metric
              label='Tamanho'
              value={formatBytes(postgres.databaseSizeBytes)}
            />
          </dl>
        ) : (
          <p className='text-muted-foreground text-sm'>{postgres.error}</p>
        )}
      </AdminPanel>
      <AdminPanel
        title='Redis'
        actions={
          <StatusPill tone={redis.ok ? 'ok' : 'bad'}>
            {redis.ok ? 'Online' : 'Falhou'}
          </StatusPill>
        }
      >
        {redis.ok ? (
          <dl className='grid grid-cols-3 gap-3 text-sm'>
            <Metric label='Latência' value={`${redis.latencyMs} ms`} />
            <Metric label='Clientes' value={String(redis.connectedClients)} />
            <Metric
              label='Memória'
              value={formatBytes(redis.usedMemoryBytes)}
            />
          </dl>
        ) : (
          <p className='text-muted-foreground text-sm'>{redis.error}</p>
        )}
      </AdminPanel>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className='text-[11px] text-muted-foreground uppercase tracking-wider'>
        {label}
      </dt>
      <dd className='font-mono tabular-nums'>{value}</dd>
    </div>
  )
}

export function AdminServerDashboard() {
  const [paused, setPaused] = useState(false)
  const query = useAdminServer(paused)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const lastSeen = useRef<string | null>(null)

  const data = query.data
  useEffect(() => {
    if (!data || lastSeen.current === data.generatedAt) return
    lastSeen.current = data.generatedAt
    setHistory((h) => appendHistory(h, data))
  }, [data])

  const pause = (
    <Button
      variant='outline'
      size='sm'
      onClick={() => setPaused((p) => !p)}
      aria-pressed={paused}
    >
      {paused ? 'Retomar' : 'Pausar'}
    </Button>
  )

  if (query.isError && !data) {
    return (
      <ErrorState
        message='Não foi possível carregar os dados do servidor.'
        action={
          <Button variant='outline' size='sm' onClick={() => query.refetch()}>
            Tentar de novo
          </Button>
        }
      />
    )
  }
  if (!data) return <TableSkeleton rows={6} />

  const alerts = data.docker.containers.filter((c) => containerAlert(c)).length

  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs'>
        <span>
          {paused ? 'Atualização pausada' : 'Atualizando a cada 5 s'} · última
          leitura{' '}
          {new Date(data.generatedAt).toLocaleTimeString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
          })}
          {query.isError && (
            <span className='text-destructive'>
              {' '}
              · falha na última tentativa
            </span>
          )}
        </span>
        {pause}
      </div>

      <HostSection host={data.host} history={history} />

      <AdminPanel
        title='Containers Docker'
        flush
        actions={
          alerts > 0 ? (
            <StatusPill tone='bad'>{`${alerts} com alerta`}</StatusPill>
          ) : undefined
        }
      >
        <ContainersTable docker={data.docker} />
      </AdminPanel>

      <ServicesSection data={data} />
    </div>
  )
}
