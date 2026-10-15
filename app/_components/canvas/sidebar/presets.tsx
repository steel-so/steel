'use client'

import { useMemo, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useCanvasDraggable } from '../dnd/canvas-dnd'
import { resolveIcon, useCanvasEditor } from '../editor-context'
import { findInsertLocation } from '../lib/drop-target'
import { normalizeSearch } from '../lib/palette'
import type { CanvasPresetItem } from '../types'
import { PaletteSearch } from './palette'

export function PresetCard({ preset }: { preset: CanvasPresetItem }) {
  const { catalog, store } = useCanvasEditor()
  const fragment = useMemo(() => preset.fragment(), [preset])
  const rootType = fragment.nodes[fragment.rootId]?.type
  const { setNodeRef, attributes, listeners, isDragging } = useCanvasDraggable(
    `preset:${preset.id}`,
    { kind: 'fragment', fragment, label: preset.label },
  )
  const insert = () => {
    const { doc, selection } = store.getState()
    const at = rootType
      ? findInsertLocation(doc, catalog, rootType, selection[0] ?? null)
      : null
    if (!at) {
      notify.info(`Não há onde inserir “${preset.label}” neste documento.`)
      return
    }
    store.insertFragment(fragment, at)
  }
  return (
    <button
      type='button'
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={insert}
      data-testid={`preset-${preset.id}`}
      aria-label={`${preset.label} — arraste para o canvas ou pressione Enter para inserir`}
      className={cn(
        'group flex w-full cursor-grab touch-none flex-col overflow-hidden rounded-lg border bg-background text-left transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing',
        isDragging && 'opacity-50',
      )}
    >
      <div className='flex aspect-[16/7] w-full items-center justify-center overflow-hidden bg-muted/60'>
        {preset.preview ? (
          preset.preview()
        ) : preset.thumbnail ? (
          <img
            src={preset.thumbnail}
            alt=''
            className='size-full object-cover object-top'
            draggable={false}
          />
        ) : (
          <SteelIcon
            icon={resolveIcon(
              catalog,
              rootType ? catalog.components[rootType]?.icon : undefined,
            )}
            className='size-6 text-muted-foreground/70 transition-colors group-hover:text-primary'
          />
        )}
      </div>
      <span className='truncate px-2.5 py-2 text-xs font-medium'>
        {preset.label}
      </span>
    </button>
  )
}

/** "Seções prontas": ready-made fragments, draggable like palette items. */
export function PresetsPanel({ presets }: { presets: CanvasPresetItem[] }) {
  const [query, setQuery] = useState('')
  const groups = useMemo(() => {
    const term = normalizeSearch(query)
    const map = new Map<string, CanvasPresetItem[]>()
    for (const preset of presets) {
      if (
        term &&
        !normalizeSearch(`${preset.label} ${preset.category}`).includes(term)
      ) {
        continue
      }
      map.set(preset.category, [...(map.get(preset.category) ?? []), preset])
    }
    return [...map.entries()]
  }, [presets, query])
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='p-3 pb-2'>
        <PaletteSearch
          value={query}
          onChange={setQuery}
          placeholder='Buscar seções'
        />
      </div>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4'>
        {groups.length === 0 && (
          <p className='px-1 py-8 text-center text-sm text-muted-foreground'>
            Nenhuma seção encontrada.
          </p>
        )}
        {groups.map(([category, items]) => (
          <section key={category}>
            <h3 className='px-0.5 pt-2 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'>
              {category}
            </h3>
            <div className='grid gap-2'>
              {items.map((preset) => (
                <PresetCard key={preset.id} preset={preset} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
