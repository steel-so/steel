'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { type Box, placeTourCard, type Size } from '@/src/lib/tours/position'
import type { TourDefinition, TourStep } from '@/src/lib/tours/types'
import type { TourProgressStatus } from '@/types/tour-progress'
import { boxOf, findTourTarget, sameBox } from './tour-dom'

/** How long the overlay waits for the screen to render its anchors. */
export const TOUR_READY_TIMEOUT_MS = 3000
const POLL_MS = 150
const TRACK_MS = 250
const HIGHLIGHT_PADDING = 6
const SCRIM = 'rgb(0 0 0 / 0.55)'
const DEFAULT_CARD: Size = { width: 340, height: 220 }

export type TourOverlayMode = 'steps' | 'summary'

interface TourOverlayProps {
  tour: TourDefinition
  mode: TourOverlayMode
  /** `null`: closed without anything to show, so it is not marked as seen. */
  onFinish: (status: TourProgressStatus | null) => void
}

const isAvailable = (step: TourStep): boolean =>
  step.target === undefined || findTourTarget(step.target) !== null

/**
 * Waits for the first anchor of the tour to be on the page, then keeps only
 * the steps whose element exists (a hidden action or an empty list simply
 * drops its step). `null` while waiting.
 */
function useAvailableSteps(
  tour: TourDefinition,
  enabled: boolean,
): readonly TourStep[] | null {
  const [steps, setSteps] = useState<readonly TourStep[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    const targeted = tour.steps.filter((step) => step.target !== undefined)
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = () => {
      const anchored = targeted.some(isAvailable)
      const expired = Date.now() - startedAt >= TOUR_READY_TIMEOUT_MS
      if (targeted.length === 0 || anchored || expired) {
        // Without a single anchor the screen is not what the tour describes
        // (empty state, no permission): nothing to show.
        setSteps(
          targeted.length > 0 && !anchored
            ? []
            : tour.steps.filter(isAvailable),
        )
        return
      }
      timer = setTimeout(check, POLL_MS)
    }
    check()

    return () => clearTimeout(timer)
  }, [tour, enabled])

  return steps
}

/** Position of the step's element, kept fresh while the page moves. */
function useTargetBox(target: string | undefined): Box | null {
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    if (target === undefined) {
      setBox(null)
      return
    }
    const first = findTourTarget(target)
    if (first && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ block: 'center', inline: 'nearest' })
    }

    const update = () => {
      const element = findTourTarget(target)
      const next = element ? boxOf(element) : null
      setBox((previous) => (sameBox(previous, next) ? previous : next))
    }
    update()

    const interval = setInterval(update, TRACK_MS)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [target])

  return box
}

export function TourOverlay({ tour, mode, onFinish }: TourOverlayProps) {
  const steps = useAvailableSteps(tour, mode === 'steps')
  const [index, setIndex] = useState(0)
  const [cardSize, setCardSize] = useState<Size>(DEFAULT_CARD)
  const [viewport, setViewport] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  const step = mode === 'steps' && steps ? (steps[index] ?? null) : null
  const box = useTargetBox(step?.target)
  const total = steps?.length ?? 0
  const isLast = index >= total - 1
  const visible = mode === 'summary' || step !== null

  // Nothing to show: close without recording, so it can open another time.
  useEffect(() => {
    if (mode === 'steps' && steps !== null && steps.length === 0) {
      onFinish(null)
    }
  }, [mode, steps, onFinish])

  const next = useCallback(() => {
    if (mode === 'summary' || isLast) onFinish('COMPLETED')
    else setIndex((current) => current + 1)
  }, [mode, isLast, onFinish])

  const back = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1))
  }, [])

  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onFinish('SKIPPED')
      } else if (event.key === 'ArrowRight') {
        next()
      } else if (event.key === 'ArrowLeft') {
        back()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [visible, next, back, onFinish])

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The card is measured after each step renders, so the placement uses its
  // real size; the focus moves to the main button for keyboard users.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const size = { width: card.offsetWidth, height: card.offsetHeight }
    if (size.width > 0 && size.height > 0) {
      setCardSize((previous) =>
        previous.width === size.width && previous.height === size.height
          ? previous
          : size,
      )
    }
    primaryRef.current?.focus({ preventScroll: true })
  }, [index, visible, viewport.width])

  if (!visible) return null

  const position = placeTourCard(box, cardSize, viewport, step?.placement)
  const title = step ? step.title : tour.title
  const body = step ? step.body : (tour.mobileSummary ?? tour.description)
  const titleId = `tour-title-${tour.key}`
  const bodyId = `tour-body-${tour.key}`

  return createPortal(
    <div data-slot='tour-overlay' className='fixed inset-0 z-[200]'>
      {/* Blocks the page while the tour runs; the scrim comes from the
          highlight's shadow, or fills the screen when there is no target. */}
      <div
        aria-hidden='true'
        className='absolute inset-0'
        style={box ? undefined : { backgroundColor: SCRIM }}
      />
      {box && (
        <div
          aria-hidden='true'
          data-slot='tour-highlight'
          className='pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200 motion-reduce:transition-none'
          style={{
            top: box.top - HIGHLIGHT_PADDING,
            left: box.left - HIGHLIGHT_PADDING,
            width: box.width + HIGHLIGHT_PADDING * 2,
            height: box.height + HIGHLIGHT_PADDING * 2,
            boxShadow: `0 0 0 9999px ${SCRIM}`,
          }}
        />
      )}
      <div
        ref={cardRef}
        role='dialog'
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-slot='tour-card'
        className='absolute flex w-[340px] max-w-[calc(100vw-1.5rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg transition-[top,left] duration-200 motion-reduce:transition-none'
        style={{ top: position.top, left: position.left }}
      >
        <div className='flex items-center justify-between gap-3 text-xs text-muted-foreground'>
          <span className='truncate'>{tour.title}</span>
          {step && total > 1 && (
            <span className='shrink-0 tabular-nums'>
              {index + 1} de {total}
            </span>
          )}
        </div>
        <div className='flex flex-col gap-1.5'>
          <h2 id={titleId} className='text-sm font-semibold'>
            {title}
          </h2>
          <p id={bodyId} className='text-sm text-muted-foreground'>
            {body}
          </p>
          {mode === 'summary' && (
            <p className='text-xs text-muted-foreground'>
              O passo a passo completo desta tela aparece no computador.
            </p>
          )}
          {(mode === 'summary' || isLast) && tour.docsHref && (
            <a
              href={tour.docsHref}
              target='_blank'
              rel='noreferrer'
              className='w-fit text-xs font-medium text-primary underline-offset-4 hover:underline'
            >
              Ver no manual
            </a>
          )}
        </div>
        <div className='flex items-center justify-between gap-2'>
          {mode === 'steps' && !isLast ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onFinish('SKIPPED')}
            >
              Pular tour
            </Button>
          ) : (
            <span />
          )}
          <div className='flex items-center gap-2'>
            {mode === 'steps' && index > 0 && (
              <Button variant='outline' size='sm' onClick={back}>
                Voltar
              </Button>
            )}
            <Button ref={primaryRef} size='sm' onClick={next}>
              {mode === 'summary' ? 'Entendi' : isLast ? 'Concluir' : 'Próximo'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
