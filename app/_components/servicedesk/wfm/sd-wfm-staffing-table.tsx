import { cn } from '@/lib/utils'
import type { SdWfmStaffingDTO } from '@/types/sd-wfm'
import { SD_TONE_SOFT } from '../sd-tone'
import { SD_WFM_DOW_SHORT, sdWfmDayLabel, sdWfmNumber } from './sd-wfm-format'

/** Agentes sugeridos por turno e dia, contra o plantão (ou o time). */
export function SdWfmStaffingTable({
  rows,
  hasOnCallSchedule,
  teamSize,
}: {
  rows: SdWfmStaffingDTO[]
  hasOnCallSchedule: boolean
  teamSize: number
}) {
  if (rows.length === 0) {
    return (
      <p className='py-6 text-center text-muted-foreground text-sm'>
        Nenhum turno configurado. Defina os turnos em “Ajustes”.
      </p>
    )
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[640px] text-left text-sm'>
        <thead className='text-muted-foreground text-xs'>
          <tr className='border-b'>
            <th className='py-2 pr-3 font-medium'>Dia</th>
            <th className='py-2 pr-3 font-medium'>Turno</th>
            <th className='py-2 pr-3 text-right font-medium'>Chamados</th>
            <th className='py-2 pr-3 text-right font-medium'>Sugeridos</th>
            <th className='py-2 pr-3 text-right font-medium'>
              {hasOnCallSchedule ? 'No plantão' : `Time (${teamSize})`}
            </th>
            <th className='py-2 font-medium'>Situação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.dateKey}-${row.shift}`}
              className='border-b last:border-0'
            >
              <td className='py-2 pr-3 whitespace-nowrap'>
                {SD_WFM_DOW_SHORT[row.dow]} {sdWfmDayLabel(row.dateKey)}
              </td>
              <td className='py-2 pr-3'>{row.shift}</td>
              <td className='py-2 pr-3 text-right tabular-nums'>
                {sdWfmNumber(row.expected)}
                <span className='ml-1 text-muted-foreground text-xs'>
                  ({sdWfmNumber(row.low)}–{sdWfmNumber(row.high)})
                </span>
              </td>
              <td className='py-2 pr-3 text-right font-medium tabular-nums'>
                {row.suggestedAgents}
              </td>
              <td className='py-2 pr-3 text-right tabular-nums'>
                {row.onCallAgents ?? teamSize}
              </td>
              <td className='py-2'>
                <StatusChip row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusChip({ row }: { row: SdWfmStaffingDTO }) {
  const [tone, label] = row.exceedsTeam
    ? (['red', 'Acima do time'] as const)
    : row.understaffed
      ? (['amber', 'Faltam pessoas'] as const)
      : (['emerald', 'Coberto'] as const)
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs',
        SD_TONE_SOFT[tone],
      )}
    >
      {label}
    </span>
  )
}
