'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useSdDepartmentOptions } from '@/src/hooks/use-sd-config-items'
import { useSdWfmForecast } from '@/src/hooks/use-sd-wfm'
import { SimpleSelect } from '../settings/sd-settings-kit'
import { SdWfmDailyChart } from './sd-wfm-daily-chart'
import { sdWfmNumber } from './sd-wfm-format'
import { SdWfmHeatmap } from './sd-wfm-heatmap'
import { SdWfmSettingsDialog } from './sd-wfm-settings-dialog'
import { SdWfmStaffingTable } from './sd-wfm-staffing-table'

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className='flex flex-col gap-3 rounded-xl border bg-card p-4'>
      <div>
        <h2 className='font-semibold text-sm'>{title}</h2>
        {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex flex-col rounded-lg border bg-card px-3 py-2'>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <span className='font-semibold text-lg tabular-nums'>{value}</span>
    </div>
  )
}

/** Demanda e escala (S5): previsão de volume e agentes sugeridos por turno. */
export function SdWfmView({
  workspaceId,
  isAdmin,
}: {
  workspaceId: string
  isAdmin: boolean
}) {
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const departments = useSdDepartmentOptions(workspaceId)
  const forecast = useSdWfmForecast(workspaceId, departmentId ?? undefined)

  if (forecast.isPending) {
    return <p className='p-6 text-muted-foreground text-sm'>Calculando…</p>
  }
  if (forecast.isError) {
    return (
      <p className='p-6 text-destructive text-sm' role='alert'>
        {forecast.error.message}
      </p>
    )
  }
  const data = forecast.data
  const weekTotal = data.hourly.reduce((sum, p) => sum + p.expected, 0)

  return (
    <div className='flex h-full min-h-0 flex-col gap-4 overflow-auto p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <SimpleSelect
          value={departmentId}
          onChange={setDepartmentId}
          allowEmpty
          emptyLabel='Todos os departamentos'
          placeholder='Todos os departamentos'
          options={(departments.data ?? []).map((d) => ({
            value: d.id,
            label: d.name,
          }))}
          className='w-56'
        />
        <span className='text-muted-foreground text-xs'>
          Horários no fuso {data.timeZone}
        </span>
        {isAdmin ? (
          <Button
            variant='outline'
            size='sm'
            className='ml-auto'
            onClick={() => setEditing(true)}
          >
            Ajustes
          </Button>
        ) : null}
      </div>

      {data.insufficientData ? (
        <p
          role='status'
          className='rounded-lg border bg-muted/40 px-3 py-2 text-sm'
        >
          Ainda há pouco histórico ({data.historyTickets} chamados em{' '}
          {data.historyWeeksWithData}{' '}
          {data.historyWeeksWithData === 1 ? 'semana' : 'semanas'}). Os números
          abaixo são só indicativos e melhoram a cada semana de uso.
        </p>
      ) : null}

      <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
        <Stat
          label='Previstos nos próximos 7 dias'
          value={sdWfmNumber(weekTotal)}
        />
        <Stat
          label='Chamados no histórico'
          value={String(data.historyTickets)}
        />
        <Stat
          label='Tendência'
          value={`${data.trend >= 1 ? '+' : ''}${sdWfmNumber((data.trend - 1) * 100)}%`}
        />
        <Stat label='Time' value={String(data.teamSize)} />
      </div>

      <Section
        title='Volume médio por hora da semana'
        hint='Quanto mais escuro, mais chamados chegam naquela hora.'
      >
        <SdWfmHeatmap heatmap={data.heatmap} />
      </Section>
      <Section
        title='Previsão dos próximos 14 dias'
        hint='A barra é o esperado; a haste mostra a faixa entre o cenário baixo e o alto.'
      >
        <SdWfmDailyChart days={data.daily} />
      </Section>
      <Section
        title='Escala sugerida por turno'
        hint={
          data.hasOnCallSchedule
            ? 'Comparada com as pessoas no plantão no início de cada turno.'
            : 'Sem escala de plantão: comparada com o tamanho do time.'
        }
      >
        <SdWfmStaffingTable
          rows={data.staffing}
          hasOnCallSchedule={data.hasOnCallSchedule}
          teamSize={data.teamSize}
        />
      </Section>

      {editing ? (
        <SdWfmSettingsDialog
          workspaceId={workspaceId}
          settings={data.settings}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}
