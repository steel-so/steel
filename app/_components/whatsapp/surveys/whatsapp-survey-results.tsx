'use client'

import { useState } from 'react'
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useSurveyReport } from '@/src/hooks/use-satisfaction-surveys'
import type {
  SurveyKindDTO,
  SurveyReportDTO,
  SurveyReportRowDTO,
} from '@/types/satisfaction-survey'
import {
  formatNumber,
  formatPercent,
  GROUP_LABEL,
  KIND_HINT,
  KIND_LABEL,
} from './survey-labels'

type GroupBy = SurveyReportDTO['groupBy']
const PERIODS = [
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'all', label: 'Todo o período' },
] as const

function headline(kind: SurveyKindDTO, row: SurveyReportRowDTO) {
  if (kind === 'NPS') return { label: 'NPS', value: formatNumber(row.nps) }
  if (kind === 'CSAT')
    return { label: 'Satisfeitos (4–5)', value: formatPercent(row.csat) }
  return { label: 'Esforço médio', value: formatNumber(row.ces, 2) }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='rounded-lg border bg-card p-4'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 text-2xl font-semibold tabular-nums'>{value}</p>
    </div>
  )
}

export function WhatsappSurveyResults({
  workspaceId,
}: {
  workspaceId: string
}) {
  const [kind, setKind] = useState<SurveyKindDTO>('CSAT')
  const [groupBy, setGroupBy] = useState<GroupBy>('agent')
  const [period, setPeriod] = useState<string>('30')

  // Period bounds are query filters (instants); display uses the platform zone.
  const from =
    period === 'all'
      ? undefined
      : new Date(Date.now() - Number(period) * 24 * 3_600_000).toISOString()
  const report = useSurveyReport(workspaceId, { kind, groupBy, from })

  return (
    <div className='space-y-6 p-6'>
      <div className='flex flex-wrap items-end gap-4'>
        <div className='space-y-1.5'>
          <Label>Pesquisa</Label>
          <Select
            value={kind}
            onValueChange={(v) => v && setKind(v as SurveyKindDTO)}
          >
            <SelectTrigger className='w-52' aria-label='Tipo de pesquisa'>
              <SelectValue>{KIND_LABEL[kind]}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {(Object.keys(KIND_LABEL) as SurveyKindDTO[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label>Agrupar por</Label>
          <Select
            value={groupBy}
            onValueChange={(v) => v && setGroupBy(v as GroupBy)}
          >
            <SelectTrigger className='w-44' aria-label='Agrupar por'>
              <SelectValue>{GROUP_LABEL[groupBy]}</SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
                  <SelectItem key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-1.5'>
          <Label>Período</Label>
          <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
            <SelectTrigger className='w-48' aria-label='Período'>
              <SelectValue>
                {PERIODS.find((p) => p.value === period)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className='text-sm text-muted-foreground'>{KIND_HINT[kind]}</p>

      {report.isLoading ? (
        <div className='space-y-3'>
          <Skeleton className='h-20 w-full' />
          <Skeleton className='h-48 w-full' />
        </div>
      ) : report.isError ? (
        <p className='text-sm text-destructive'>{report.error.message}</p>
      ) : report.data ? (
        <>
          <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
            <Stat label='Enviadas' value={String(report.data.total.sent)} />
            <Stat
              label='Respondidas'
              value={String(report.data.total.answered)}
            />
            <Stat
              label='Taxa de resposta'
              value={formatPercent(report.data.total.responseRate)}
            />
            <Stat {...headline(kind, report.data.total)} />
          </div>

          {report.data.rows.length === 0 ? (
            <p className='rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
              Nenhuma pesquisa enviada neste período. Ative a pesquisa em Regras
              para começar a coletar notas.
            </p>
          ) : (
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{GROUP_LABEL[groupBy]}</TableHead>
                    <TableHead className='text-right'>Enviadas</TableHead>
                    <TableHead className='text-right'>Respondidas</TableHead>
                    <TableHead className='text-right'>Resposta</TableHead>
                    <TableHead className='text-right'>Média</TableHead>
                    <TableHead className='text-right'>
                      {headline(kind, report.data.total).label}
                    </TableHead>
                    {kind === 'NPS' ? (
                      <TableHead className='text-right'>
                        Prom. / Neutros / Detr.
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.data.rows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className='font-medium'>{row.name}</TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {row.sent}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {row.answered}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatPercent(row.responseRate)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {formatNumber(row.average, 2)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {headline(kind, row).value}
                      </TableCell>
                      {kind === 'NPS' ? (
                        <TableCell className='text-right tabular-nums'>
                          {row.promoters} / {row.passives} / {row.detractors}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
