import type { SdWfmForecastDTO } from '@/types/sd-wfm'
import {
  SD_WFM_DOW_ORDER,
  SD_WFM_DOW_SHORT,
  sdWfmHeatLevel,
  sdWfmHourLabel,
  sdWfmNumber,
} from './sd-wfm-format'

/**
 * Média de chamados por hora da semana. A intensidade (opacidade da cor
 * primária) é só uma camada visual: o número exato está no `title` de cada
 * célula e na tabela de turnos.
 */
export function SdWfmHeatmap({
  heatmap,
}: {
  heatmap: SdWfmForecastDTO['heatmap']
}) {
  const max = Math.max(0, ...heatmap.flat())
  return (
    <div className='overflow-x-auto'>
      <div
        role='img'
        aria-label='Mapa de calor do volume médio de chamados por dia da semana e hora'
        className='grid min-w-[640px] gap-px'
        style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }}
      >
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span
            key={hour}
            className='text-center text-[10px] text-muted-foreground'
          >
            {hour % 3 === 0 ? sdWfmHourLabel(hour) : ''}
          </span>
        ))}
        {SD_WFM_DOW_ORDER.map((dow) => (
          <HeatRow key={dow} dow={dow} row={heatmap[dow]} max={max} />
        ))}
      </div>
    </div>
  )
}

function HeatRow({
  dow,
  row,
  max,
}: {
  dow: number
  row: number[]
  max: number
}) {
  return (
    <>
      <span className='pr-2 text-right text-[11px] text-muted-foreground'>
        {SD_WFM_DOW_SHORT[dow]}
      </span>
      {row.map((value, hour) => (
        <span
          key={hour}
          title={`${SD_WFM_DOW_SHORT[dow]} ${sdWfmHourLabel(hour)}: ${sdWfmNumber(value)} chamados/h`}
          className='relative h-6 rounded-[3px] bg-muted/50'
        >
          <span
            className='absolute inset-0 rounded-[3px] bg-primary'
            style={{ opacity: sdWfmHeatLevel(value, max) }}
          />
        </span>
      ))}
    </>
  )
}
