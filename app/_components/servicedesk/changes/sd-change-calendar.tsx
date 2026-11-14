'use client'

import {
  Alert02Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  SnowIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useSdChangeCalendar } from '@/src/hooks/use-sd-changes'
import type {
  SdChangeCalendarEntryDTO,
  SdChangeWindowKindDTO,
  SdChangeWindowOccurrenceDTO,
} from '@/types/sd-change'
import { SD_TONE, SD_TONE_SOFT, SD_TONE_TEXT } from '../sd-tone'
import {
  SD_CHANGE_RISK_SHORT,
  SD_CHANGE_TYPE_SHORT,
  sdWindowKindLabel,
} from './sd-change-labels'

/**
 * Calendário de mudanças: mês ou semana, janelas de manutenção e
 * congelamento como faixas de fundo do dia, mudanças posicionadas pela janela
 * planejada (conflito e congelamento destacados) e um painel lateral do dia
 * selecionado.
 *
 * Tudo em UTC-neutro: as datas vêm em ISO e são formatadas no fuso do
 * navegador; a grade é montada a partir da data local para bater com o que o
 * agente vê no relógio dele.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const MONTH_LABEL = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
})
const DAY_LABEL = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
})
const TIME = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
})
const SHORT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const WEEK_HEADS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

type Mode = 'month' | 'week'

/*
 * Cor de estado do calendário, em mapa fechado — nunca espalhada no JSX.
 * Segue o padrão do repositório (`bg-<c>-500/10` + `text-<c>-700
 * dark:text-<c>-300`), que tem contraste no claro e no escuro com uma única
 * declaração e fica visível ao Tailwind. Tudo que não é estado (superfície,
 * borda, texto) usa token do tema.
 */

/** Faixa de fundo do dia por tipo de janela. */
const WINDOW_SURFACE: Record<SdChangeWindowKindDTO, string> = {
  FREEZE: SD_TONE_SOFT.rose,
  MAINTENANCE: SD_TONE_SOFT.sky,
}

/** Ícone e texto da janela (cabeçalho do dia e cartão do painel). */
const WINDOW_TEXT: Record<SdChangeWindowKindDTO, string> = {
  FREEZE: SD_TONE_TEXT.rose,
  MAINTENANCE: SD_TONE_TEXT.sky,
}

const WINDOW_ICON: Record<SdChangeWindowKindDTO, typeof SnowIcon> = {
  FREEZE: SnowIcon,
  MAINTENANCE: Calendar03Icon,
}

/** Mudança em conflito (mesmo item de configuração) ou dentro de freeze. */
const CONFLICT_SURFACE = cn(SD_TONE.amber, 'font-medium')
const CONFLICT_TEXT = SD_TONE_TEXT.amber

/** Meia-noite local do dia de `date`. */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Grade visível: mês com semanas completas, ou uma semana (dom–sáb). */
function gridFor(anchor: Date, mode: Mode): { from: Date; to: Date } {
  if (mode === 'week') {
    const from = addDays(startOfDay(anchor), -anchor.getDay())
    return { from, to: addDays(from, 7) }
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const from = addDays(first, -first.getDay())
  const firstNext = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
  const to = addDays(firstNext, (7 - firstNext.getDay()) % 7)
  return { from, to }
}

function overlapsDay(startsAt: string, endsAt: string, day: Date): boolean {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  const dayStart = day.getTime()
  return start < dayStart + DAY_MS && end > dayStart
}

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

export function SdChangeCalendar({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const [mode, setMode] = useState<Mode>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [selected, setSelected] = useState(() => startOfDay(new Date()))

  const grid = useMemo(() => gridFor(anchor, mode), [anchor, mode])
  const range = useMemo(
    () => ({ from: grid.from.toISOString(), to: grid.to.toISOString() }),
    [grid],
  )
  const { data, isLoading, error } = useSdChangeCalendar(workspaceId, range)

  const days = useMemo(() => {
    const out: Date[] = []
    for (
      let cursor = grid.from;
      cursor < grid.to;
      cursor = addDays(cursor, 1)
    ) {
      out.push(cursor)
    }
    return out
  }, [grid])

  const windows = data?.windows ?? []
  const changes = data?.changes ?? []

  const step = (direction: -1 | 1) => {
    setAnchor((current) =>
      mode === 'week'
        ? addDays(current, 7 * direction)
        : new Date(current.getFullYear(), current.getMonth() + direction, 1),
    )
  }

  const title =
    mode === 'week'
      ? `${SHORT.format(grid.from).slice(0, 5)} – ${SHORT.format(addDays(grid.to, -1)).slice(0, 5)}`
      : MONTH_LABEL.format(anchor)

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3'>
        <div data-tour='sd-change-period' className='flex items-center gap-1'>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Período anterior'
            onClick={() => step(-1)}
          >
            <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            aria-label='Próximo período'
            onClick={() => step(1)}
          >
            <SteelIcon icon={ArrowRight01Icon} strokeWidth={2} />
          </Button>
          <span className='ml-1 font-medium text-sm capitalize'>{title}</span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='ml-2'
            onClick={() => {
              const today = startOfDay(new Date())
              setAnchor(today)
              setSelected(today)
            }}
          >
            Hoje
          </Button>
        </div>
        <div
          data-tour='sd-change-mode'
          className='flex items-center gap-1 rounded-lg border p-0.5'
        >
          <Button
            type='button'
            size='sm'
            variant={mode === 'month' ? 'default' : 'ghost'}
            onClick={() => setMode('month')}
          >
            Mês
          </Button>
          <Button
            type='button'
            size='sm'
            variant={mode === 'week' ? 'default' : 'ghost'}
            onClick={() => setMode('week')}
          >
            Semana
          </Button>
        </div>
      </div>

      <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
        <div className='flex min-h-0 flex-1 flex-col p-3'>
          {error ? (
            <div className='rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground text-sm'>
              {error.message}
            </div>
          ) : (
            <>
              <div className='grid grid-cols-7 gap-1 pb-1'>
                {WEEK_HEADS.map((head) => (
                  <div
                    key={head}
                    className='px-1 text-center font-medium text-[11px] text-muted-foreground uppercase'
                  >
                    {head}
                  </div>
                ))}
              </div>
              <div
                data-tour='sd-change-grid'
                className={cn(
                  'grid min-h-0 flex-1 auto-rows-fr grid-cols-7 gap-1',
                  isLoading && 'opacity-60',
                )}
              >
                {days.map((day) => (
                  <DayCell
                    key={day.toISOString()}
                    day={day}
                    anchor={anchor}
                    mode={mode}
                    selected={isSameDay(day, selected)}
                    windows={windows}
                    changes={changes}
                    onSelect={() => setSelected(day)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <DayPanel
          slug={slug}
          day={selected}
          windows={windows}
          changes={changes}
        />
      </div>
    </div>
  )
}

function DayCell({
  day,
  anchor,
  mode,
  selected,
  windows,
  changes,
  onSelect,
}: {
  day: Date
  anchor: Date
  mode: Mode
  selected: boolean
  windows: SdChangeWindowOccurrenceDTO[]
  changes: SdChangeCalendarEntryDTO[]
  onSelect: () => void
}) {
  const dayWindows = windows.filter((w) =>
    overlapsDay(w.startsAt, w.endsAt, day),
  )
  const dayChanges = changes.filter((c) =>
    overlapsDay(c.plannedStartAt, c.plannedEndAt, day),
  )
  const frozen = dayWindows.some((w) => w.kind === 'FREEZE')
  const maintenance = dayWindows.some((w) => w.kind === 'MAINTENANCE')
  const outside = mode === 'month' && day.getMonth() !== anchor.getMonth()
  const today = isSameDay(day, new Date())
  // Congelamento tem precedência sobre manutenção na faixa do dia.
  const kind: SdChangeWindowKindDTO | null = frozen
    ? 'FREEZE'
    : maintenance
      ? 'MAINTENANCE'
      : null

  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${DAY_LABEL.format(day)}${frozen ? ' · congelamento' : ''}${
        dayChanges.length > 0 ? ` · ${dayChanges.length} mudança(s)` : ''
      }`}
      className={cn(
        'relative flex min-h-24 flex-col gap-1 overflow-hidden rounded-lg border p-1.5 text-left transition-colors',
        kind ? WINDOW_SURFACE[kind] : 'border-border bg-card',
        outside && 'opacity-50',
        selected && 'ring-2 ring-primary ring-offset-1 ring-offset-background',
      )}
    >
      <div className='flex items-center justify-between gap-1'>
        <span
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
            today
              ? 'bg-primary font-semibold text-primary-foreground'
              : 'text-muted-foreground',
          )}
        >
          {day.getDate()}
        </span>
        {kind ? (
          <SteelIcon
            icon={WINDOW_ICON[kind]}
            strokeWidth={2}
            className={cn('size-3.5', WINDOW_TEXT[kind])}
          />
        ) : null}
      </div>
      <div className='flex min-h-0 flex-col gap-0.5 overflow-hidden'>
        {dayChanges.slice(0, 3).map((change) => {
          const conflicted =
            change.conflictTicketIds.length > 0 ||
            change.frozenWindowIds.length > 0
          return (
            <span
              key={change.ticketId}
              className={cn(
                'truncate rounded px-1 py-0.5 text-[11px] leading-tight',
                conflicted ? CONFLICT_SURFACE : 'bg-muted text-foreground',
              )}
            >
              {conflicted ? '⚠ ' : ''}
              {change.code} · {change.title}
            </span>
          )
        })}
        {dayChanges.length > 3 ? (
          <span className='px-1 text-[11px] text-muted-foreground'>
            +{dayChanges.length - 3} mudança(s)
          </span>
        ) : null}
      </div>
    </button>
  )
}

function DayPanel({
  slug,
  day,
  windows,
  changes,
}: {
  slug: string
  day: Date
  windows: SdChangeWindowOccurrenceDTO[]
  changes: SdChangeCalendarEntryDTO[]
}) {
  const dayWindows = windows.filter((w) =>
    overlapsDay(w.startsAt, w.endsAt, day),
  )
  const dayChanges = changes.filter((c) =>
    overlapsDay(c.plannedStartAt, c.plannedEndAt, day),
  )
  const byId = new Map(changes.map((c) => [c.ticketId, c]))

  return (
    <aside
      data-tour='sd-change-day'
      className='flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t p-4 lg:w-80 lg:border-t-0 lg:border-l'
    >
      <div>
        <h2 className='font-medium text-sm capitalize'>
          {DAY_LABEL.format(day)}
        </h2>
        <p className='text-muted-foreground text-xs'>
          {dayChanges.length} mudança(s) · {dayWindows.length} janela(s)
        </p>
      </div>

      {dayWindows.length > 0 ? (
        <section className='flex flex-col gap-2'>
          <h3 className='font-medium text-muted-foreground text-xs uppercase'>
            Janelas
          </h3>
          {dayWindows.map((window) => (
            <div
              key={`${window.windowId}-${window.startsAt}`}
              className={cn(
                'rounded-lg border px-3 py-2',
                WINDOW_SURFACE[window.kind],
              )}
            >
              <div className='flex items-center gap-1.5'>
                <SteelIcon
                  icon={WINDOW_ICON[window.kind]}
                  strokeWidth={2}
                  className={cn('size-4 shrink-0', WINDOW_TEXT[window.kind])}
                />
                <span className='truncate font-medium text-sm'>
                  {window.name}
                </span>
              </div>
              <p className='text-muted-foreground text-xs'>
                {sdWindowKindLabel(window.kind)} ·{' '}
                {TIME.format(new Date(window.startsAt))} –{' '}
                {TIME.format(new Date(window.endsAt))}
                {window.recurring ? ' · repetição' : ''}
              </p>
              {window.description ? (
                <p className='mt-1 text-muted-foreground text-xs'>
                  {window.description}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <section className='flex flex-col gap-2'>
        <h3 className='font-medium text-muted-foreground text-xs uppercase'>
          Mudanças
        </h3>
        {dayChanges.length === 0 ? (
          <p className='rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground text-xs'>
            Nenhuma mudança agendada neste dia.
          </p>
        ) : (
          dayChanges.map((change) => {
            const conflicts = change.conflictTicketIds
              .map((id) => byId.get(id))
              .filter((c): c is SdChangeCalendarEntryDTO => !!c)
            return (
              <Link
                key={change.ticketId}
                href={`/${slug}/servicedesk/tickets/${change.number}`}
                className='flex flex-col gap-1 rounded-lg border border-border bg-card px-3 py-2 transition-colors hover:border-primary/50'
              >
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-mono text-muted-foreground text-xs'>
                    {change.code}
                  </span>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {TIME.format(new Date(change.plannedStartAt))} –{' '}
                    {TIME.format(new Date(change.plannedEndAt))}
                  </span>
                </div>
                <span className='font-medium text-sm leading-tight'>
                  {change.title}
                </span>
                <div className='flex flex-wrap gap-1'>
                  <Badge variant='outline'>{change.phaseName}</Badge>
                  {change.changeType ? (
                    <Badge variant='secondary'>
                      {SD_CHANGE_TYPE_SHORT[change.changeType] ??
                        change.changeType}
                    </Badge>
                  ) : null}
                  {change.changeRisk ? (
                    <Badge variant='secondary'>
                      Risco{' '}
                      {SD_CHANGE_RISK_SHORT[change.changeRisk] ??
                        change.changeRisk}
                    </Badge>
                  ) : null}
                  {change.configItemName ? (
                    <Badge variant='outline'>{change.configItemName}</Badge>
                  ) : null}
                </div>
                {change.frozenWindowIds.length > 0 ? (
                  <p
                    className={cn(
                      'flex items-start gap-1 text-xs',
                      WINDOW_TEXT.FREEZE,
                    )}
                  >
                    <SteelIcon
                      icon={SnowIcon}
                      strokeWidth={2}
                      className='mt-px size-3.5 shrink-0'
                    />
                    Dentro de uma janela de congelamento
                  </p>
                ) : null}
                {conflicts.length > 0 ? (
                  <p
                    className={cn(
                      'flex items-start gap-1 text-xs',
                      CONFLICT_TEXT,
                    )}
                  >
                    <SteelIcon
                      icon={Alert02Icon}
                      strokeWidth={2}
                      className='mt-px size-3.5 shrink-0'
                    />
                    Conflito com {conflicts.map((c) => c.code).join(', ')} no
                    mesmo item de configuração
                  </p>
                ) : null}
              </Link>
            )
          })
        )}
      </section>
    </aside>
  )
}
