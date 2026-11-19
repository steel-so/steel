'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { sortPeriods } from '@/src/lib/google-business/profile'
import {
  GOOGLE_WEEKDAY_LABELS,
  GOOGLE_WEEKDAYS,
  type GoogleHoursPeriodDTO,
  type GoogleWeekday,
} from '@/src/schemas/crm-google-presence.schema'

const DEFAULT_OPEN = '09:00'
const DEFAULT_CLOSE = '18:00'

/** `<input type="time">` cannot show 24:00 (open until midnight): show 23:59. */
const displayTime = (value: string) => (value === '24:00' ? '23:59' : value)

/** Weekly opening hours: one switch per day, one or more periods when open. */
export function GoogleHoursEditor({
  value,
  onChange,
  disabled,
}: {
  value: GoogleHoursPeriodDTO[]
  onChange: (next: GoogleHoursPeriodDTO[]) => void
  disabled?: boolean
}) {
  const periodsOf = (day: GoogleWeekday) =>
    sortPeriods(value.filter((period) => period.day === day))

  function replaceDay(day: GoogleWeekday, periods: GoogleHoursPeriodDTO[]) {
    onChange(sortPeriods([...value.filter((p) => p.day !== day), ...periods]))
  }

  function updatePeriod(
    day: GoogleWeekday,
    index: number,
    patch: Partial<GoogleHoursPeriodDTO>,
  ) {
    replaceDay(
      day,
      periodsOf(day).map((period, i) =>
        i === index ? { ...period, ...patch } : period,
      ),
    )
  }

  return (
    <ul className='divide-y divide-border/60 rounded-xl border border-border/60'>
      {GOOGLE_WEEKDAYS.map((day) => {
        const periods = periodsOf(day)
        const open = periods.length > 0
        return (
          <li
            key={day}
            className='flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4'
          >
            <div className='flex w-full items-center gap-3 sm:w-48'>
              <Switch
                checked={open}
                disabled={disabled}
                aria-label={`${GOOGLE_WEEKDAY_LABELS[day]} aberto`}
                onCheckedChange={(checked) =>
                  replaceDay(
                    day,
                    checked
                      ? [{ day, open: DEFAULT_OPEN, close: DEFAULT_CLOSE }]
                      : [],
                  )
                }
              />
              <span className='font-medium text-sm'>
                {GOOGLE_WEEKDAY_LABELS[day]}
              </span>
            </div>

            <div className='min-w-0 flex-1 space-y-2'>
              {open ? (
                periods.map((period, index) => (
                  <div
                    key={`${day}-${index}`}
                    className='flex flex-wrap items-center gap-2'
                  >
                    <input
                      type='time'
                      aria-label={`${GOOGLE_WEEKDAY_LABELS[day]}: abre às`}
                      value={displayTime(period.open)}
                      disabled={disabled}
                      onChange={(event) =>
                        updatePeriod(day, index, { open: event.target.value })
                      }
                      className='h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
                    />
                    <span className='text-muted-foreground text-sm'>até</span>
                    <input
                      type='time'
                      aria-label={`${GOOGLE_WEEKDAY_LABELS[day]}: fecha às`}
                      value={displayTime(period.close)}
                      disabled={disabled}
                      onChange={(event) =>
                        updatePeriod(day, index, { close: event.target.value })
                      }
                      className='h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'
                    />
                    {periods.length > 1 ? (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-sm'
                        disabled={disabled}
                        aria-label='Remover faixa de horário'
                        onClick={() =>
                          replaceDay(
                            day,
                            periods.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <SteelIcon icon={Delete02Icon} size={14} />
                      </Button>
                    ) : null}
                  </div>
                ))
              ) : (
                <span className='text-muted-foreground text-sm'>Fechado</span>
              )}
              {open && periods.length < 3 ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='xs'
                  disabled={disabled}
                  onClick={() => {
                    const last = periods[periods.length - 1]
                    replaceDay(day, [
                      ...periods,
                      {
                        day,
                        open: last.close === '24:00' ? '23:00' : last.close,
                        close: '23:59',
                      },
                    ])
                  }}
                >
                  <SteelIcon icon={Add01Icon} size={12} />
                  Adicionar faixa
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
