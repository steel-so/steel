'use client'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import type { WhatsAppSchedWeeklyHoursDTO } from '@/types/whatsapp-scheduling'
import { WEEKDAYS } from './scheduling-labels'

const DEFAULT_WINDOW = { start: '09:00', end: '18:00' }

/** One window per weekday (enough for the common shop and clinic days). */
export function WorkingHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: WhatsAppSchedWeeklyHoursDTO
  onChange: (value: WhatsAppSchedWeeklyHoursDTO) => void
  disabled?: boolean
}) {
  return (
    <div className='space-y-2'>
      {WEEKDAYS.map(({ key, label }) => {
        const window = value[key]?.[0]
        const setWindow = (next: { start: string; end: string } | null) => {
          const copy = { ...value }
          if (next) copy[key] = [next]
          else delete copy[key]
          onChange(copy)
        }
        return (
          <div key={key} className='flex flex-wrap items-center gap-3'>
            <Switch
              aria-label={`Atende ${label}`}
              checked={Boolean(window)}
              disabled={disabled}
              onCheckedChange={(on) => setWindow(on ? DEFAULT_WINDOW : null)}
            />
            <span className='w-20 text-sm'>{label}</span>
            {window ? (
              <>
                <Input
                  type='time'
                  aria-label={`${label}: início`}
                  className='w-28'
                  value={window.start}
                  disabled={disabled}
                  onChange={(event) =>
                    setWindow({ ...window, start: event.target.value })
                  }
                />
                <span className='text-muted-foreground text-sm'>até</span>
                <Input
                  type='time'
                  aria-label={`${label}: fim`}
                  className='w-28'
                  value={window.end}
                  disabled={disabled}
                  onChange={(event) =>
                    setWindow({ ...window, end: event.target.value })
                  }
                />
              </>
            ) : (
              <span className='text-muted-foreground text-xs'>Folga</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
