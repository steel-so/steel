'use client'

import { Download01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useWhatsAppSlaReport,
  whatsAppSlaReportCsvUrl,
} from '@/src/hooks/use-whatsapp-sla'
import { useWhatsAppTeams } from '@/src/hooks/use-whatsapp-teams'
import { formatSlaSpan } from '@/src/lib/whatsapp/sla-format'
import type {
  WhatsAppSlaBreakdownRowDTO,
  WhatsAppSlaReportDTO,
} from '@/types/whatsapp-sla'

const TIME_ZONE = 'America/Sao_Paulo'
const DAY_MS = 24 * 60 * 60 * 1000
const ALL_TEAMS = 'all'

/** `YYYY-MM-DD` of `date` in the workspace time zone (never the browser's). */
function zonedDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${String(value).replace('.', ',')}%`
}

function formatSeconds(value: number | null): string {
  return value === null ? '—' : formatSlaSpan(value * 1000)
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

function BreakdownTable({
  title,
  rows,
}: {
  title: string
  rows: WhatsAppSlaBreakdownRowDTO[]
}) {
  return (
    <div className='min-w-0 space-y-2'>
      <h4 className='font-medium text-sm'>{title}</h4>
      {rows.length === 0 ? (
        <p className='text-muted-foreground text-xs'>Sem dados no período.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className='text-right'>Atendimentos</TableHead>
              <TableHead className='text-right'>Estouros</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id ?? row.label}>
                <TableCell className='max-w-48 truncate'>{row.label}</TableCell>
                <TableCell className='text-right'>{row.cycles}</TableCell>
                <TableCell className='text-right'>{row.breaches}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function ReportBody({ report }: { report: WhatsAppSlaReportDTO }) {
  const { firstResponse, resolution } = report
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        <Metric
          label='Primeira resposta no prazo'
          value={formatPercent(firstResponse.withinPercent)}
          hint={`${firstResponse.withinTarget} de ${firstResponse.evaluated}`}
        />
        <Metric
          label='Tempo médio da primeira resposta'
          value={formatSeconds(firstResponse.averageSeconds)}
        />
        <Metric
          label='P90 da primeira resposta'
          value={formatSeconds(firstResponse.p90Seconds)}
          hint='9 de cada 10 respondidas em até'
        />
        <Metric
          label='Resolução no prazo'
          value={formatPercent(resolution.withinPercent)}
          hint={`${resolution.withinTarget} de ${resolution.evaluated}`}
        />
      </div>
      <div className='grid gap-6 lg:grid-cols-2'>
        <BreakdownTable title='Por atendente' rows={report.byAgent} />
        <BreakdownTable title='Por equipe' rows={report.byTeam} />
      </div>
    </div>
  )
}

/**
 * SLA section of the WhatsApp reports: % within target, average and p90
 * first-response time and breaches by agent and team, with CSV export.
 * Hidden for people the API refuses (plain agents).
 */
export function WhatsappSlaReport({ workspaceId }: { workspaceId: string }) {
  const [today] = useState(() => new Date())
  const [from, setFrom] = useState(() =>
    zonedDay(new Date(today.getTime() - 29 * DAY_MS)),
  )
  const [to, setTo] = useState(() => zonedDay(today))
  const [teamId, setTeamId] = useState(ALL_TEAMS)
  const teams = useWhatsAppTeams(workspaceId)

  const params = {
    from: from || undefined,
    to: to || undefined,
    teamId: teamId === ALL_TEAMS ? undefined : teamId,
  }
  const report = useWhatsAppSlaReport(workspaceId, params)

  // Plain agents have no SLA report: say nothing instead of an error.
  if (report.isError) return null

  return (
    <section className='space-y-4 border-b p-6' aria-label='Relatório de SLA'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h3 className='font-medium text-sm'>SLA do atendimento</h3>
          <p className='text-muted-foreground text-xs'>
            Atendimentos iniciados no período (horário de Brasília). Prazos
            ainda em andamento não entram na conta.
          </p>
        </div>
        <Button
          size='sm'
          variant='outline'
          render={
            <a
              href={whatsAppSlaReportCsvUrl(workspaceId, params)}
              download='relatorio-sla.csv'
            />
          }
        >
          <SteelIcon icon={Download01Icon} strokeWidth={2} />
          Exportar CSV
        </Button>
      </div>

      <div className='flex flex-wrap items-end gap-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='slaFrom'>De</Label>
          <Input
            id='slaFrom'
            type='date'
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
            className='w-40'
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='slaTo'>Até</Label>
          <Input
            id='slaTo'
            type='date'
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
            className='w-40'
          />
        </div>
        <div className='space-y-1.5'>
          <Label>Equipe</Label>
          <Select
            value={teamId}
            onValueChange={(value) => setTeamId(value ?? ALL_TEAMS)}
          >
            <SelectTrigger className='w-48' aria-label='Equipe do relatório'>
              <SelectValue>
                {teamId === ALL_TEAMS
                  ? 'Todas as equipes'
                  : (teams.data ?? []).find((team) => team.id === teamId)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value={ALL_TEAMS}>Todas as equipes</SelectItem>
                {(teams.data ?? []).map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {report.data ? (
        <ReportBody report={report.data} />
      ) : (
        <p className='text-muted-foreground text-sm'>Carregando...</p>
      )}
    </section>
  )
}
