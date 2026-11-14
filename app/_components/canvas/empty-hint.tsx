'use client'

import { Add01Icon, Cursor01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { useCanvasStore } from './use-canvas'

const SEEN_KEY = 'steel:canvas-hint-seen'

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Storage is blocked: the tip simply shows again next time.
  }
}

/**
 * Orientation over the canvas. An empty page explains how to add the first
 * element; the first time an editor opens with content, a dismissible tip
 * explains click, drag and the shortcuts. Never intercepts the pointer
 * outside its own card.
 */
export function CanvasHint() {
  const empty = useCanvasStore((state) => {
    const root = state.doc.nodes[state.doc.rootId]
    return !root || (root.children?.length ?? 0) === 0
  })
  const [seen, setSeen] = useState(true)
  useEffect(() => setSeen(readSeen()), [])
  const dismiss = () => {
    writeSeen()
    setSeen(true)
  }

  if (empty) {
    return (
      <div className='pointer-events-none absolute inset-x-0 top-24 z-10 flex justify-center px-4'>
        <div
          data-testid='canvas-empty-hint'
          className='pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-lg border bg-background/95 p-5 text-center shadow-sm'
        >
          <span className='flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <SteelIcon icon={Add01Icon} className='size-5' />
          </span>
          <p className='text-sm font-semibold'>Comece adicionando um bloco</p>
          <p className='text-xs text-muted-foreground'>
            Abra “Adicionar” na barra lateral e arraste um elemento para cá, ou
            escolha uma seção pronta.
          </p>
        </div>
      </div>
    )
  }
  if (seen) return null
  return (
    <div
      role='note'
      data-testid='canvas-first-use-hint'
      className='absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-sm'
    >
      <SteelIcon
        icon={Cursor01Icon}
        className='size-4 shrink-0 text-muted-foreground'
      />
      <span className='text-muted-foreground'>
        Clique em um elemento para editar, arraste para mover. As alterações são
        salvas sozinhas.
      </span>
      <button
        type='button'
        onClick={dismiss}
        className='shrink-0 rounded-md px-2 py-1 font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        Entendi
      </button>
    </div>
  )
}
