'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  MinusSignIcon,
  PlusSignIcon,
  Redo02Icon,
  Undo02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ZOOM_MAX, ZOOM_MIN } from '@/src/lib/canvas/store'
import { useCollabSession, useCollabSnapshot } from './collab/collab-context'
import { CollabPresence } from './collab/presence-bar'
import { useCanvasEditor, useCanvasEditorUi } from './editor-context'
import { DEFAULT_VIEWPORTS, fitZoom } from './frame/canvas-stage'
import { BREAKPOINT_LABELS } from './lib/messages'
import { shortcutHint } from './lib/shortcut-hint'
import { DeviceSwitcher } from './preview/device-switcher'
import { ThemeSwitcher } from './preview/theme-switcher'
import { SaveStatus, type SaveStatusValue } from './save-status'
import { useCanvasStore } from './use-canvas'

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

/** Next/previous preset zoom from the current value. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? ZOOM_STEPS.find((step) => step > zoom + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001)
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next ?? zoom))
}

export const isMac = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export const modKey = () => (isMac() ? '⌘' : 'Ctrl')

export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  active,
  shortcut,
  className,
}: {
  label: string
  icon: IconSvgElement
  onClick: () => void
  disabled?: boolean
  active?: boolean
  shortcut?: string
  className?: string
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-muted text-foreground',
        className,
      )}
    >
      <SteelIcon icon={icon} className='size-4' />
    </button>
  )
}

function SaveIndicator() {
  const { saveStatus } = useCanvasEditorUi()
  const { save } = useCanvasEditor()
  const dirty = useCanvasStore((state) => state.dirty)
  // Live co-editing: the realtime server saves, so "saved" means synced.
  const session = useCollabSession()
  const live = useCollabSnapshot(
    (snapshot) => snapshot.status === 'live' && !snapshot.readOnly,
  )
  const syncing = useCollabSnapshot((snapshot) => snapshot.syncing)
  const status: SaveStatusValue =
    saveStatus === 'saving'
      ? 'saving'
      : saveStatus === 'error' && !(session && live)
        ? 'error'
        : session && live
          ? syncing
            ? 'syncing'
            : 'saved'
          : dirty
            ? 'dirty'
            : 'saved'
  return (
    <SaveStatus
      status={status}
      onRetry={() => void save()}
      className='hidden md:flex'
    />
  )
}

function ZoomControl() {
  const { store, frame, props } = useCanvasEditor()
  const zoom = useCanvasStore((state) => state.zoom)
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const fit = () => {
    const width =
      props.viewportWidths[breakpoint] ?? DEFAULT_VIEWPORTS[breakpoint]
    store.setZoom(fitZoom(width, frame.scroller?.clientWidth ?? 0))
  }
  return (
    <div className='flex items-center rounded-md border bg-background'>
      <IconButton
        label='Diminuir zoom'
        icon={MinusSignIcon}
        shortcut={shortcutHint('canvas.zoom-out')}
        className='size-7'
        disabled={zoom <= ZOOM_MIN}
        onClick={() => store.setZoom(stepZoom(zoom, -1))}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label='Zoom'
          className='h-7 min-w-12 rounded-sm px-1 text-xs font-medium tabular-nums hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          {Math.round(zoom * 100)}%
        </DropdownMenuTrigger>
        <DropdownMenuContent align='center' className='w-40'>
          <DropdownMenuItem onClick={fit}>
            Ajustar à tela
            <DropdownMenuShortcut>
              {shortcutHint('canvas.zoom-fit')}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {ZOOM_STEPS.map((step) => (
            <DropdownMenuItem key={step} onClick={() => store.setZoom(step)}>
              {step * 100}%
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <IconButton
        label='Aumentar zoom'
        icon={PlusSignIcon}
        shortcut={shortcutHint('canvas.zoom-in')}
        className='size-7'
        disabled={zoom >= ZOOM_MAX}
        onClick={() => store.setZoom(stepZoom(zoom, 1))}
      />
    </div>
  )
}

/**
 * Editor top bar: title on the left; breakpoints, zoom, history and preview
 * in the middle; save state and the caller's actions on the right.
 */
export function CanvasTopBar({ title }: { title: ReactNode }) {
  const { store, catalog, props } = useCanvasEditor()
  const { dark, setDark } = useCanvasEditorUi()
  const breakpoint = useCanvasStore((state) => state.breakpoint)
  const canUndo = useCanvasStore((state) => state.canUndo)
  const canRedo = useCanvasStore((state) => state.canRedo)

  return (
    <header className='flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3'>
      <div className='flex min-w-0 flex-1 items-center gap-2 text-sm font-medium'>
        {title}
      </div>

      <div className='flex items-center gap-2' data-tour='canvas-toolbar'>
        {catalog.breakpoints.length > 1 && (
          <DeviceSwitcher
            value={breakpoint}
            onChange={(item) => store.setBreakpoint(item)}
            devices={catalog.breakpoints}
            widths={{
              base: props.viewportWidths.base ?? DEFAULT_VIEWPORTS.base,
              tablet: props.viewportWidths.tablet ?? DEFAULT_VIEWPORTS.tablet,
              mobile: props.viewportWidths.mobile ?? DEFAULT_VIEWPORTS.mobile,
            }}
            labels={BREAKPOINT_LABELS}
          />
        )}
        <ZoomControl />
        <div className='flex items-center'>
          <IconButton
            label='Desfazer'
            icon={Undo02Icon}
            shortcut={shortcutHint('canvas.undo')}
            disabled={!canUndo}
            onClick={() => store.undo()}
          />
          <IconButton
            label='Refazer'
            icon={Redo02Icon}
            shortcut={shortcutHint('canvas.redo')}
            disabled={!canRedo}
            onClick={() => store.redo()}
          />
        </div>
        {props.darkPreview && (
          <ThemeSwitcher
            value={dark ? 'dark' : 'light'}
            onChange={(theme) => setDark(theme === 'dark')}
          />
        )}
      </div>

      <div className='flex flex-1 items-center justify-end gap-3'>
        <CollabPresence />
        <SaveIndicator />
        {props.actions?.({ store })}
      </div>
    </header>
  )
}
