import type { SdWfmDayDTO } from '@/types/sd-wfm'
import { SD_WFM_DOW_SHORT, sdWfmDayLabel, sdWfmNumber } from './sd-wfm-format'

/** Barras do volume esperado por dia, com a faixa baixa–alta como haste. */
export function SdWfmDailyChart({ days }: { days: SdWfmDayDTO[] }) {
  const max = Math.max(1, ...days.map((d) => d.high))
  return (
    <div
      role='img'
      aria-label='Volume previsto de chamados por dia, com faixa baixa e alta'
      className='flex h-48 items-end gap-1.5'
    >
      {days.map((day) => (
        <div
          key={day.dateKey}
          className='flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1'
          title={`${sdWfmDayLabel(day.dateKey)}: ${sdWfmNumber(day.expected)} (entre ${sdWfmNumber(day.low)} e ${sdWfmNumber(day.high)})`}
        >
          <span className='text-[10px] text-muted-foreground tabular-nums'>
            {sdWfmNumber(day.expected)}
          </span>
          <div className='relative w-full flex-1'>
            <div
              className='absolute inset-x-0 bottom-0 rounded-t bg-primary/80'
              style={{ height: `${(day.expected / max) * 100}%` }}
            />
            <div
              className='absolute left-1/2 w-px -translate-x-1/2 bg-foreground/50'
              style={{
                bottom: `${(day.low / max) * 100}%`,
                height: `${((day.high - day.low) / max) * 100}%`,
              }}
            />
          </div>
          <span className='text-[10px] text-muted-foreground'>
            {SD_WFM_DOW_SHORT[day.dow]} {sdWfmDayLabel(day.dateKey)}
          </span>
        </div>
      ))}
    </div>
  )
}
