'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useWhatsAppAgentReport,
  whatsAppAgentReportCsvUrl,
} from '@/src/hooks/use-whatsapp-agent-report'
import { useWhatsAppConnections } from '@/src/hooks/use-whatsapp-connections'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import {
  AGENT_REPORT_DEFAULT_PRESET,
  AGENT_REPORT_PRESET_LABELS,
  type AgentReportPreset,
  agentReportPresetRange,
} from '@/src/lib/whatsapp/agent-report'
import { formatSlaSpan } from '@/src/lib/whatsapp/sla-format'
import type {
  WhatsAppAgentReportDTO,
  WhatsAppAgentReportMetricsDTO,
  WhatsAppAgentReportStatusCountDTO,
} from '@/types/whatsapp-agent-report'

const ALL = 'all'
const PRESETS = Object.keys(AGENT_REPORT_PRESET_LABELS) as AgentReportPreset[]

const VISIBILITY_HINT: Record<WhatsAppAgentReportDTO['visibility'], string> = {
  ALL: 'Todos os atendentes do workspace.',
  TEAMS: 'Atendentes das equipes que você lidera.',
  SELF: 'Somente o seu desempenho.',
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${String(value).replace('.', ',')}%`
}

function formatDuration(seconds: number | null): string {
  return seconds === null ? '—' : formatSlaSpan(seconds * 1000)
}

function formatDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className='rounded-md border p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p className='mt-1 font-semibold text-xl'>{value}</p>
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

function Totals({ totals }: { totals: WhatsAppAgentReportMetricsDTO }) {
  return (
    <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'>
      <Metric
        label='Encerradas'
        value={String(totals.closed)}
        hint={`${totals.tabulated} tabuladas`}
      />
      <Metric
        label='Taxa de sucesso'
        value={formatPercent(totals.successRate)}
        hint={`${totals.success} sucesso · ${totals.failure} insucesso`}
      />
      <Metric
        label='Sem tabulação'
        value={String(totals.untabulated)}
        hint='Encerradas sem escolher status'
      />
      <Metric
        label='Tempo médio de atendimento'
        value={formatDuration(totals.avgHandlingSeconds)}
        hint='Da criação ao encerramento'
      />
      <Metric
        label='Em aberto agora'
        value={String(totals.open)}
        hint='Conversas ainda não encerradas'
      />
    </div>
  )
}

function StatusBadge({
  status,
}: {
  status: WhatsAppAgentReportStatusCountDTO
}) {
  return (
    <Badge variant={status.outcome === 'FAILURE' ? 'destructive' : 'secondary'}>
      {status.label} · {status.count}
    </Badge>
  )
}

function AgentsTable({ report }: { report: WhatsAppAgentReportDTO }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Atendente</TableHead>
          <TableHead className='text-right'>Encerradas</TableHead>
          <TableHead className='text-right'>Sucesso</TableHead>
          <TableHead className='text-right'>Insucesso</TableHead>
          <TableHead className='text-right'>Taxa de sucesso</TableHead>
          <TableHead className='text-right'>Sem tabulação</TableHead>
          <TableHead className='text-right'>Tempo médio</TableHead>
          <TableHead className='text-right'>Em aberto</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.rows.map((row) => (
          <TableRow key={row.agentId ?? 'unassigned'}>
            <TableCell className='max-w-72 whitespace-normal'>
              <p className='truncate font-medium'>{row.agentName}</p>
              {row.byStatus.length > 0 ? (
                <div className='mt-1 flex flex-wrap gap-1'>
                  {row.byStatus.map((status) => (
                    <StatusBadge key={status.label} status={status} />
                  ))}
                </div>
              ) : null}
            </TableCell>
            <TableCell className='text-right'>{row.closed}</TableCell>
            <TableCell className='text-right'>{row.success}</TableCell>
            <TableCell className='text-right'>{row.failure}</TableCell>
            <TableCell className='text-right'>
              {formatPercent(row.successRate)}
            </TableCell>
            <TableCell className='text-right'>{row.untabulated}</TableCell>
            <TableCell className='text-right'>
              {formatDuration(row.avgHandlingSeconds)}
            </TableCell>
            <TableCell className='text-right'>{row.open}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className='font-medium'>Total</TableCell>
          <TableCell className='text-right'>{report.totals.closed}</TableCell>
          <TableCell className='text-right'>{report.totals.success}</TableCell>
          <TableCell className='text-right'>{report.totals.failure}</TableCell>
          <TableCell className='text-right'>
            {formatPercent(report.totals.successRate)}
          </TableCell>
          <TableCell className='text-right'>
            {report.totals.untabulated}
          </TableCell>
          <TableCell className='text-right'>
            {formatDuration(report.totals.avgHandlingSeconds)}
          </TableCell>
          <TableCell className='text-right'>{report.totals.open}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}

function StatusSummary({
  statuses,
}: {
  statuses: WhatsAppAgentReportDTO['statuses']
}) {
  if (statuses.length === 0) return null
  return (
    <div className='min-w-0 space-y-2'>
      <h4 className='font-medium text-sm'>Resumo por status de fechamento</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead className='text-right'>Conversas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {statuses.map((status) => (
            <TableRow key={status.label}>
              <TableCell className='max-w-72 truncate'>
                {status.label}
              </TableCell>
              <TableCell>
                {status.outcome === 'SUCCESS'
                  ? 'Sucesso'
                  : status.outcome === 'FAILURE'
                    ? 'Insucesso'
                    : '—'}
              </TableCell>
              <TableCell className='text-right'>{status.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className='text-muted-foreground text-xs'>
        Uma conversa com mais de um status conta em cada um deles.
      </p>
    </div>
  )
}

function ReportBody({ report }: { report: WhatsAppAgentReportDTO }) {
  if (report.rows.length === 0) {
    return (
      <p className='rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm'>
        Nenhuma conversa encerrada nem em aberto para os filtros escolhidos.
      </p>
    )
  }
  return (
    <div className='space-y-4'>
      <Totals totals={report.totals} />
      <AgentsTable report={report} />
      <StatusSummary statuses={report.statuses} />
    </div>
  )
}

/**
 * "Atendentes" tab of the zap reports (ADR 0062): tabulation performance per
 * agent in a period, with team and connection filters and CSV export. The
 * tab only exists for workspaces where the platform admin enabled it.
 */
export function WhatsappAgentReport({ workspaceId }: { workspaceId: string }) {
  const [range, setRange] = useState(() =>
    agentReportPresetRange(AGENT_REPORT_DEFAULT_PRESET),
  )
  const [preset, setPreset] = useState<AgentReportPreset | 'custom'>(
    AGENT_REPORT_DEFAULT_PRESET,
  )
  const [teamId, setTeamId] = useState(ALL)
  const [connectionId, setConnectionId] = useState(ALL)
  const teams = useWhatsAppTeams(workspaceId).data ?? []
  const connections = useWhatsAppConnections(workspaceId).data ?? []

  const params = {
    ...range,
    ...(teamId === ALL ? {} : { teamId }),
    ...(connectionId === ALL ? {} : { connectionId }),
  }
  const {
    data: report,
    isLoading,
    error,
  } = useWhatsAppAgentReport(workspaceId, params)

  function choosePreset(next: AgentReportPreset) {
    setPreset(next)
    setRange(agentReportPresetRange(next))
  }

  function changeDate(key: 'from' | 'to', value: string) {
    if (!value) return
    setPreset('custom')
    setRange((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className='space-y-4 p-6' aria-label='Relatório de atendentes'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h3 className='font-medium text-sm'>Desempenho dos atendentes</h3>
          <p className='text-muted-foreground text-xs'>
            Conversas encerradas no período (horário de Brasília), contadas para
            o atendente responsável no encerramento.{' '}
            {report ? VISIBILITY_HINT[report.visibility] : ''}
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          render={
            <a href={whatsAppAgentReportCsvUrl(workspaceId, params)} download />
          }
        >
          <SteelIcon icon={Download01Icon} strokeWidth={2} />
          Exportar CSV
        </Button>
      </div>

      <div className='flex flex-wrap items-end gap-3'>
        <fieldset className='m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0'>
          <legend className='sr-only'>Período</legend>
          {PRESETS.map((key) => (
            <Button
              key={key}
              type='button'
              size='sm'
              variant={preset === key ? 'default' : 'outline'}
              aria-pressed={preset === key}
              onClick={() => choosePreset(key)}
            >
              {AGENT_REPORT_PRESET_LABELS[key]}
            </Button>
          ))}
        </fieldset>
        <div className='space-y-1'>
          <Label htmlFor='agentReportFrom' className='text-xs'>
            De
          </Label>
          <Input
            id='agentReportFrom'
            type='date'
            value={range.from}
            max={range.to}
            onChange={(event) => changeDate('from', event.target.value)}
            className='w-40'
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='agentReportTo' className='text-xs'>
            Até
          </Label>
          <Input
            id='agentReportTo'
            type='date'
            value={range.to}
            min={range.from}
            onChange={(event) => changeDate('to', event.target.value)}
            className='w-40'
          />
        </div>
        {teams.length > 0 ? (
          <div className='space-y-1'>
            <Label className='text-xs'>Equipe</Label>
            <Select
              value={teamId}
              onValueChange={(value) => setTeamId(value ?? ALL)}
            >
              <SelectTrigger className='w-48' aria-label='Equipe do relatório'>
                <SelectValue>
                  {teamId === ALL
                    ? 'Todas as equipes'
                    : teams.find((team) => team.id === teamId)?.name}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value={ALL}>Todas as equipes</SelectItem>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {connections.length > 0 ? (
          <div className='space-y-1'>
            <Label className='text-xs'>Conexão</Label>
            <Select
              value={connectionId}
              onValueChange={(value) => setConnectionId(value ?? ALL)}
            >
              <SelectTrigger className='w-48' aria-label='Conexão do relatório'>
                <SelectValue>
                  {connectionId === ALL
                    ? 'Todas as conexões'
                    : connections.find((row) => row.id === connectionId)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value={ALL}>Todas as conexões</SelectItem>
                  {connections.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {report ? (
        <p className='text-muted-foreground text-xs'>
          Período: {formatDay(report.fromDay)} a {formatDay(report.toDay)}.
        </p>
      ) : null}

      {isLoading ? (
        <div className='space-y-3' aria-busy>
          <Skeleton className='h-20 w-full rounded-xl' />
          <Skeleton className='h-48 w-full rounded-xl' />
        </div>
      ) : report ? (
        <ReportBody report={report} />
      ) : (
        <p className='text-destructive text-sm'>
          {error instanceof Error
            ? error.message
            : 'Não foi possível carregar o relatório de atendentes.'}
        </p>
      )}
    </section>
  )
}
