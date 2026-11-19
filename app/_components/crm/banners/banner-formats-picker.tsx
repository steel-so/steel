'use client'

import { cn } from '@/lib/utils'
import {
  BANNER_FORMAT_GROUP_LABELS,
  BANNER_FORMATS,
  type BannerFormatGroup,
  formatSize,
} from '@/src/lib/banners/formats'

const GROUPS = Object.keys(BANNER_FORMAT_GROUP_LABELS) as BannerFormatGroup[]

/** Multi-select of the format library, grouped by platform. */
export function BannerFormatsPicker({
  selected,
  onChange,
  disabledIds = [],
}: {
  selected: string[]
  onChange: (ids: string[]) => void
  /** Formats that cannot be unchecked (the one being edited). */
  disabledIds?: string[]
}) {
  function toggle(id: string) {
    if (disabledIds.includes(id)) return
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    )
  }

  return (
    <div className='grid gap-4'>
      {GROUPS.map((group) => {
        const formats = BANNER_FORMATS.filter((f) => f.group === group)
        const ids = formats.map((f) => f.id)
        const all = ids.every((id) => selected.includes(id))
        return (
          <fieldset key={group} className='grid gap-2'>
            <legend className='mb-1 flex w-full items-center justify-between text-sm'>
              <span className='font-medium'>
                {BANNER_FORMAT_GROUP_LABELS[group]}
              </span>
              <button
                type='button'
                className='text-primary text-xs underline-offset-2 hover:underline'
                onClick={() =>
                  onChange(
                    all
                      ? selected.filter(
                          (id) => !ids.includes(id) || disabledIds.includes(id),
                        )
                      : [...new Set([...selected, ...ids])],
                  )
                }
              >
                {all ? 'Limpar grupo' : 'Selecionar grupo'}
              </button>
            </legend>
            <div className='flex flex-wrap gap-1.5'>
              {formats.map((format) => {
                const checked = selected.includes(format.id)
                return (
                  <label
                    key={format.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors',
                      checked
                        ? 'border-primary/60 bg-primary/5'
                        : 'hover:bg-muted',
                      disabledIds.includes(format.id) && 'cursor-default',
                    )}
                  >
                    <input
                      type='checkbox'
                      checked={checked}
                      disabled={disabledIds.includes(format.id)}
                      onChange={() => toggle(format.id)}
                      className='accent-primary'
                    />
                    <span>{format.label}</span>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {formatSize(format)}
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
