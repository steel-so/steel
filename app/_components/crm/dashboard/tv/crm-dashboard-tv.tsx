'use client'

import {
  Cancel01Icon,
  FullScreenIcon,
  RefreshIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import * as React from 'react'
import ReactGridLayout, {
  type Layout,
  useContainerWidth,
} from 'react-grid-layout'
import { DashboardDisplayProvider } from '@/app/_components/crm/dashboard/dashboard-display'
import { winSentence } from '@/app/_components/crm/dashboard/sales/sales-blocks'
import {
  pageOfWidget,
  widgetTitle,
} from '@/app/_components/crm/dashboard/widget-title'
import { WidgetView } from '@/app/_components/crm/dashboard/widget-view'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { salesWindow } from '@/src/lib/crm-sales/period'
import type { CrmDashboardSettings } from '@/src/schemas/crm-dashboard.schema'
import type { SalesMetricOf } from '@/src/schemas/crm-sales-metrics.schema'
import type {
  CrmDashboardLookupsDTO,
  CrmDashboardWidgetDTO,
} from '@/types/crm-dashboard'

const COLS = 12
/** Recarrega os números de todos os widgets. */
export const TV_REFRESH_MS = 60_000
/** Procura vitórias novas para comemorar. */
export const TV_WINS_POLL_MS = 15_000
/** Quanto tempo a comemoração fica na tela. */
export const CELEBRATION_MS = 7_000
const CURSOR_IDLE_MS = 4_000
const MIN_ROW_HEIGHT = 24
const MARGIN = 14

type Win = SalesMetricOf<'wins-feed'>['rows'][number]

/** Telas (índices) que têm widgets, na ordem — as que a TV alterna. */
export function tvScreens(
  widgets: Pick<CrmDashboardWidgetDTO, 'page'>[],
  pageCount: number,
): number[] {
  const used = new Set(widgets.map((w) => pageOfWidget(w, pageCount)))
  return [...used].sort((a, b) => a - b)
}

/** `?interval=` em segundos (10 s a 10 min); sem ele, o do painel. */
export function tvRotationSeconds(
  settings: CrmDashboardSettings,
  override?: string,
): number {
  const seconds = Number.parseInt(override ?? '', 10)
  if (Number.isFinite(seconds)) return Math.min(600, Math.max(10, seconds))
  return settings.rotateSeconds
}

/** "16d 08h 12min" até `end` (ou "último dia" quando falta menos de 1 dia). */
export function countdownLabel(now: Date, end: Date): string {
  const ms = Math.max(0, end.getTime() - now.getTime())
  const totalMinutes = Math.floor(ms / 60_000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  return days > 0 ? `${days}d ${hh}h ${mm}min` : `${hh}h ${mm}min`
}

function useNow(stepMs: number): Date | null {
  // Começa `null`: o HTML do servidor e o do cliente nasceriam com horas
  // diferentes e quebrariam a hidratação.
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), stepMs)
    return () => clearInterval(timer)
  }, [stepMs])
  return now
}

function useIdleCursor(): boolean {
  const [idle, setIdle] = React.useState(false)
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      setIdle(false)
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS)
    }
    schedule()
    window.addEventListener('mousemove', schedule)
    window.addEventListener('keydown', schedule)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('mousemove', schedule)
      window.removeEventListener('keydown', schedule)
    }
  }, [])
  return idle
}

function useFullscreen(): { active: boolean; toggle: () => void } {
  const [active, setActive] = React.useState(false)
  React.useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement))
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const toggle = React.useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.()
      return
    }
    void document.documentElement.requestFullscreen?.()
  }, [])
  return { active, toggle }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    const sync = () => setReduced(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])
  return reduced
}

/**
 * Procura vitórias a cada 15 s. A primeira leitura só marca o que já
 * existia; uma vitória que aparece depois vira comemoração.
 */
export function useWinCelebrations(
  url: string,
  onGone?: () => void,
): { celebrating: Win | null; dismiss: () => void } {
  const seen = React.useRef<Set<string> | null>(null)
  const [queue, setQueue] = React.useState<Win[]>([])
  const goneRef = React.useRef(onGone)
  goneRef.current = onGone

  React.useEffect(() => {
    let active = true
    async function poll() {
      try {
        const response = await fetch(url)
        if (response.status === 404) {
          goneRef.current?.()
          return
        }
        const json = (await response.json()) as {
          success?: boolean
          data?: SalesMetricOf<'wins-feed'>
        }
        if (!active || !json.success || !json.data) return
        const rows = json.data.rows
        if (seen.current === null) {
          seen.current = new Set(rows.map((row) => row.id))
          return
        }
        const known = seen.current
        const fresh = rows.filter((row) => !known.has(row.id))
        for (const row of fresh) known.add(row.id)
        // Mais antiga primeiro: comemora na ordem em que fecharam.
        if (fresh.length > 0) setQueue((prev) => [...prev, ...fresh.reverse()])
      } catch {
        // Rede instável na TV: tenta de novo no próximo ciclo.
      }
    }
    void poll()
    const timer = setInterval(poll, TV_WINS_POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [url])

  const celebrating = queue[0] ?? null
  const dismiss = React.useCallback(() => setQueue((prev) => prev.slice(1)), [])

  React.useEffect(() => {
    if (!celebrating) return
    const timer = setTimeout(dismiss, CELEBRATION_MS)
    return () => clearTimeout(timer)
  }, [celebrating, dismiss])

  return { celebrating, dismiss }
}

const CONFETTI = Array.from({ length: 36 }, (_, index) => index)
const CONFETTI_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-primary)',
]

/** Confete com Web Animations (sem CSS global; a CSP aceita). */
function Confetti() {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const pieces = ref.current?.querySelectorAll<HTMLElement>('[data-piece]')
    if (!pieces) return
    const animations = [...pieces].map((piece, index) => {
      const angle = (index / pieces.length) * Math.PI * 2
      const distance = 180 + ((index * 53) % 220)
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance - 120
      return piece.animate?.(
        [
          { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(${dx}px, ${dy + 260}px) rotate(${(index % 2 ? 1 : -1) * 540}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: 1800 + (index % 5) * 160,
          easing: 'cubic-bezier(.2,.7,.3,1)',
          fill: 'forwards',
        },
      )
    })
    return () => {
      for (const animation of animations) animation?.cancel()
    }
  }, [])
  return (
    <div ref={ref} aria-hidden className='pointer-events-none absolute inset-0'>
      {CONFETTI.map((index) => (
        <span
          key={index}
          data-piece
          className='absolute top-1/2 left-1/2 block h-3 w-2 rounded-sm'
          style={{
            background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
          }}
        />
      ))}
    </div>
  )
}

export function CelebrationOverlay({
  win,
  reducedMotion,
  onDismiss,
}: {
  win: Win
  reducedMotion: boolean
  onDismiss: () => void
}) {
  return (
    <div
      role='status'
      aria-live='polite'
      data-testid='tv-celebration'
      className='absolute inset-0 z-20 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm'
    >
      {reducedMotion ? null : <Confetti />}
      <button
        type='button'
        onClick={onDismiss}
        className={cn(
          'relative max-w-[min(90vw,64rem)] rounded-3xl border border-border bg-card px-10 py-8 text-center shadow-2xl',
          !reducedMotion &&
            'motion-safe:fade-in-0 motion-safe:zoom-in-90 motion-safe:animate-in motion-safe:duration-500',
        )}
      >
        <span
          aria-hidden
          className='block text-[clamp(3rem,9vh,8rem)] leading-none'
        >
          🎉
        </span>
        <span className='mt-4 block font-semibold text-[clamp(1.8rem,5.5vh,5rem)] text-foreground leading-tight'>
          {winSentence(win)}
        </span>
        <span className='mt-2 block text-[clamp(1rem,2.6vh,2.2rem)] text-muted-foreground'>
          {win.opportunityName}
        </span>
      </button>
    </div>
  )
}

function TvButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: typeof RefreshIcon
  onClick: () => void
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      className='flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
    >
      <SteelIcon icon={icon} strokeWidth={2} className='size-4' />
    </button>
  )
}

const CLOCK_TIME = (timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
const CLOCK_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone,
  })

export interface CrmDashboardTvProps {
  title: string
  settings: CrmDashboardSettings
  widgets: CrmDashboardWidgetDTO[]
  /** Workspace do painel ('' no link público). */
  workspaceId: string
  /** Fuso do workspace: relógio e contagem até o fim do mês. */
  timeZone: string
  /** Link público da TV (`/tv/<token>`). */
  tvToken?: string
  lookups?: CrmDashboardLookupsDTO
  /** Botão de sair (só no modo TV com login). */
  exitHref?: string
  /** `?interval=` (segundos) sobrepõe a rotação do painel. */
  interval?: string
  /** O link foi revogado ou deixou de valer. */
  onGone?: () => void
}

/**
 * Modo TV de um painel do CRM (sala de vendas): tela cheia escura, letras
 * grandes, relógio, contagem até o fim do mês, rotação entre as telas do
 * painel, atualização a cada minuto e comemoração na hora em que sai uma
 * venda (respeitando `prefers-reduced-motion`).
 */
export function CrmDashboardTv({
  title,
  settings,
  widgets,
  workspaceId,
  timeZone,
  tvToken,
  lookups,
  exitHref,
  interval,
  onGone,
}: CrmDashboardTvProps) {
  const pageCount = settings.pages.length
  const screens = React.useMemo(
    () => tvScreens(widgets, pageCount),
    [widgets, pageCount],
  )
  const rotationMs = tvRotationSeconds(settings, interval) * 1000
  const [index, setIndex] = React.useState(0)
  const screen = screens[index % Math.max(1, screens.length)] ?? 0

  React.useEffect(() => {
    if (screens.length < 2 || rotationMs <= 0) return
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % screens.length),
      rotationMs,
    )
    return () => clearInterval(timer)
  }, [screens.length, rotationMs])

  const [refreshKey, setRefreshKey] = React.useState(0)
  const refresh = React.useCallback(() => setRefreshKey((key) => key + 1), [])
  React.useEffect(() => {
    const timer = setInterval(refresh, TV_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const visible = React.useMemo(
    () => widgets.filter((w) => pageOfWidget(w, pageCount) === screen),
    [widgets, pageCount, screen],
  )

  const { width, containerRef, mounted } = useContainerWidth()
  const [height, setHeight] = React.useState(0)
  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const sync = () => setHeight(element.clientHeight)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [containerRef])

  const layout: Layout = React.useMemo(
    () =>
      visible.map((widget) => ({
        i: widget.id,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
        static: true,
      })),
    [visible],
  )
  // A tela inteira cabe na TV: a altura da linha vem da altura útil.
  const rows = visible.reduce((max, w) => Math.max(max, w.y + w.h), 0)
  const rowHeight =
    rows > 0 && height > 0
      ? Math.max(MIN_ROW_HEIGHT, (height - MARGIN * (rows + 1)) / rows)
      : 48

  const now = useNow(1000)
  const idle = useIdleCursor()
  const fullscreen = useFullscreen()
  const reducedMotion = usePrefersReducedMotion()
  const winsUrl = tvToken
    ? `/api/crm/tv/${tvToken}/wins`
    : `/api/workspaces/${workspaceId}/crm/sales-metrics?kind=wins-feed&limit=5`
  const { celebrating, dismiss } = useWinCelebrations(winsUrl, onGone)

  const monthEnd = now ? salesWindow(now, timeZone, 'month').end : null
  const time = CLOCK_TIME(timeZone)
  const day = CLOCK_DAY(timeZone)

  return (
    <div
      data-testid='crm-dashboard-tv'
      className={cn(
        // `dark` escopa os tokens escuros no overlay, mesmo com o app claro.
        'dark fixed inset-0 z-50 flex flex-col bg-background text-foreground',
        idle && 'cursor-none',
      )}
    >
      <header className='flex shrink-0 items-center gap-4 border-border border-b px-6 py-3'>
        <div className='min-w-0 flex-1'>
          <h1 className='truncate font-semibold text-2xl tracking-tight 2xl:text-4xl'>
            {title || 'Painel'}
          </h1>
          <div className='mt-1 flex items-center gap-3 text-muted-foreground text-sm 2xl:text-lg'>
            <span className='truncate' data-testid='tv-screen-title'>
              {settings.pages[screen] ?? ''}
            </span>
            {screens.length > 1 ? (
              <span className='flex items-center gap-1.5' aria-hidden>
                {screens.map((page, position) => (
                  <span
                    key={page}
                    className={cn(
                      'size-2 rounded-full 2xl:size-3',
                      position === index % screens.length
                        ? 'bg-foreground'
                        : 'bg-muted-foreground/40',
                    )}
                  />
                ))}
              </span>
            ) : null}
          </div>
        </div>
        <div className='hidden text-right md:block'>
          <p className='text-muted-foreground text-xs uppercase tracking-wide 2xl:text-base'>
            Fim do mês em
          </p>
          <p
            className='font-semibold text-xl tabular-nums 2xl:text-4xl'
            data-testid='tv-countdown'
          >
            {now && monthEnd ? countdownLabel(now, monthEnd) : '—'}
          </p>
        </div>
        <div className='text-right'>
          <p className='font-semibold text-3xl tabular-nums 2xl:text-6xl'>
            <span className='sr-only'>Hora atual: </span>
            {now ? time.format(now) : '--:--'}
          </p>
          <p className='text-muted-foreground text-sm capitalize 2xl:text-lg'>
            {now ? day.format(now) : ''}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <TvButton
            label='Atualizar agora'
            icon={RefreshIcon}
            onClick={refresh}
          />
          <TvButton
            label={fullscreen.active ? 'Sair da tela cheia' : 'Tela cheia'}
            icon={FullScreenIcon}
            onClick={fullscreen.toggle}
          />
          {exitHref ? (
            <Link
              href={exitHref}
              aria-label='Sair do modo TV'
              title='Sair do modo TV'
              className='flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'
            >
              <SteelIcon
                icon={Cancel01Icon}
                strokeWidth={2}
                className='size-4'
              />
            </Link>
          ) : null}
        </div>
      </header>

      <div
        ref={containerRef}
        className='relative min-h-0 flex-1 overflow-hidden p-3'
      >
        {visible.length === 0 ? (
          <p className='flex h-full items-center justify-center text-muted-foreground text-xl'>
            Este painel ainda não tem widgets.
          </p>
        ) : null}
        {mounted && width > 0 && visible.length > 0 ? (
          <DashboardDisplayProvider
            variant='tv'
            refreshKey={refreshKey}
            tvToken={tvToken}
            lookups={lookups}
          >
            <ReactGridLayout
              key={screen}
              width={width}
              layout={layout}
              gridConfig={{
                cols: COLS,
                rowHeight,
                margin: [MARGIN, MARGIN],
                containerPadding: [0, 0],
              }}
              dragConfig={{ enabled: false }}
              resizeConfig={{ enabled: false }}
            >
              {visible.map((widget) => (
                <div
                  key={widget.id}
                  className='flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card'
                >
                  <div className='shrink-0 border-border border-b px-4 py-2'>
                    <span className='line-clamp-1 font-medium text-muted-foreground text-sm uppercase tracking-wide 2xl:text-lg'>
                      {widgetTitle(widget)}
                    </span>
                  </div>
                  <div className='min-h-0 flex-1 p-3'>
                    <WidgetView widget={widget} workspaceId={workspaceId} />
                  </div>
                </div>
              ))}
            </ReactGridLayout>
          </DashboardDisplayProvider>
        ) : null}

        {celebrating ? (
          <CelebrationOverlay
            key={celebrating.id}
            win={celebrating}
            reducedMotion={reducedMotion}
            onDismiss={dismiss}
          />
        ) : null}
      </div>
    </div>
  )
}
