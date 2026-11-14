'use client'

import { usePathname } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMarkTourSeen, useTourProgress } from '@/src/hooks/use-tour-progress'
import { findTourForPath, pathAfterSlug } from '@/src/lib/tours/match'
import { TOURS } from '@/src/lib/tours/registry'
import type { TourDefinition } from '@/src/lib/tours/types'
import type { TourProgressStatus } from '@/types/tour-progress'
import {
  hasOpenDialog,
  isAutoStartDisabled,
  isMobileViewport,
  takeTourParam,
} from './tour-dom'
import { TourListDialog } from './tour-list-dialog'
import { TourOverlay, type TourOverlayMode } from './tour-overlay'

/** Lets the screen paint before the tour covers it. */
export const TOUR_AUTO_START_DELAY_MS = 700

interface TourContextValue {
  slug: string
  /** Tours this user may see (admin-only ones hidden from members). */
  tours: readonly TourDefinition[]
  /** The tour of the screen on display, if it has one. */
  currentTour: TourDefinition | null
  /** Has the user seen the current version of this tour? */
  isSeen: (tour: TourDefinition) => boolean
  /** Opens a tour now, whether or not it was seen before. */
  start: (tour: TourDefinition) => void
  openList: () => void
}

const TourContext = createContext<TourContextValue | null>(null)

/** `null` outside the workspace shell (onboarding, admin, public pages). */
export function useTours(): TourContextValue | null {
  return useContext(TourContext)
}

interface ActiveTour {
  tour: TourDefinition
  mode: TourOverlayMode
}

const modeFor = (tour: TourDefinition): TourOverlayMode =>
  tour.desktopOnly && isMobileViewport() ? 'summary' : 'steps'

export function TourProvider({
  slug,
  isAdmin,
  children,
}: {
  slug: string
  isAdmin: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const progress = useTourProgress()
  const { mutate: markSeen } = useMarkTourSeen()
  const [active, setActive] = useState<ActiveTour | null>(null)
  const [listOpen, setListOpen] = useState(false)
  // Tours already opened by themselves since the page loaded: never twice.
  const autoStarted = useRef(new Set<string>())
  const activeRef = useRef<ActiveTour | null>(null)
  activeRef.current = active

  const tours = useMemo(
    () => TOURS.filter((tour) => isAdmin || tour.audience !== 'admin'),
    [isAdmin],
  )
  const path = pathAfterSlug(pathname, slug)
  const currentTour = useMemo(
    () => (path === null ? null : findTourForPath(tours, path)),
    [tours, path],
  )

  const seenVersions = useMemo(
    () =>
      new Map((progress.data ?? []).map((item) => [item.key, item.version])),
    [progress.data],
  )
  const isSeen = useCallback(
    (tour: TourDefinition) => (seenVersions.get(tour.key) ?? 0) >= tour.version,
    [seenVersions],
  )

  const start = useCallback((tour: TourDefinition) => {
    setListOpen(false)
    setActive({ tour, mode: modeFor(tour) })
  }, [])

  const finish = useCallback(
    (status: TourProgressStatus | null) => {
      const current = activeRef.current
      if (!current) return
      setActive(null)
      if (status !== null) {
        markSeen({
          key: current.tour.key,
          version: current.tour.version,
          status,
        })
      }
    },
    [markSeen],
  )

  // Leaving the screen in the middle of a tour counts as skipping it.
  useEffect(() => {
    const current = activeRef.current
    if (current && current.tour.key !== currentTour?.key) finish('SKIPPED')
  }, [currentTour, finish])

  // First visit (or a newer version of the tour): open it by itself. A
  // `?tour=<key>` link from the tours list opens it regardless.
  useEffect(() => {
    if (!currentTour) return
    const requested = takeTourParam() === currentTour.key
    if (requested) {
      start(currentTour)
      return
    }
    if (!progress.isSuccess || isSeen(currentTour)) return
    if (autoStarted.current.has(currentTour.key)) return
    if (isAutoStartDisabled()) return

    const tour = currentTour
    const timer = setTimeout(() => {
      if (activeRef.current || hasOpenDialog()) return
      autoStarted.current.add(tour.key)
      setActive({ tour, mode: modeFor(tour) })
    }, TOUR_AUTO_START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [currentTour, pathname, progress.isSuccess, isSeen, start])

  const openList = useCallback(() => setListOpen(true), [])

  const value = useMemo<TourContextValue>(
    () => ({ slug, tours, currentTour, isSeen, start, openList }),
    [slug, tours, currentTour, isSeen, start, openList],
  )

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourListDialog open={listOpen} onOpenChange={setListOpen} />
      {active && (
        <TourOverlay
          key={active.tour.key}
          tour={active.tour}
          mode={active.mode}
          onFinish={finish}
        />
      )}
    </TourContext.Provider>
  )
}
