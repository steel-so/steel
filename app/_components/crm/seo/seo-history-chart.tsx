import { cn } from '@/lib/utils'
import type { SiteSeoHistoryPointDTO } from '@/types/site-seo'

/**
 * Score history as lines (SEO, AEO, GEO and the overall mean). Colors come
 * from variables on the wrapper, with a dark-theme set, so the chart follows
 * the theme. Points carry a native tooltip (`<title>`), and the legend names
 * every series, so color is never the only cue.
 */

const SERIES = [
  { key: 'overall', label: 'Geral', color: 'var(--seo-overall)', width: 2.5 },
  { key: 'seo', label: 'SEO', color: 'var(--seo-seo)', width: 1.5 },
  { key: 'aeo', label: 'AEO', color: 'var(--seo-aeo)', width: 1.5 },
  { key: 'geo', label: 'GEO', color: 'var(--seo-geo)', width: 1.5 },
] as const

const VARS =
  '[--seo-overall:#2a78d6] [--seo-seo:#1f8a4c] [--seo-aeo:#b26b00] [--seo-geo:#8a4fd0] dark:[--seo-overall:#3987e5] dark:[--seo-seo:#4cc27e] dark:[--seo-aeo:#f0a43a] dark:[--seo-geo:#b794f0]'

const WIDTH = 640
const HEIGHT = 220
const PAD = { left: 32, right: 12, top: 12, bottom: 24 }

function formatDay(day: string) {
  const [, month, date] = day.split('-')
  return `${date}/${month}`
}

export function SeoHistoryChart({
  points,
  className,
}: {
  points: SiteSeoHistoryPointDTO[]
  className?: string
}) {
  const innerW = WIDTH - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (index: number) =>
    PAD.left +
    (points.length > 1 ? (index / (points.length - 1)) * innerW : innerW / 2)
  const y = (value: number) => PAD.top + innerH * (1 - value / 100)
  const labelIndexes = points.length
    ? [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
    : []

  return (
    <figure className={cn('grid gap-2', VARS, className)}>
      <svg
        role='img'
        aria-label='Evolução das notas de SEO, AEO e GEO'
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='h-auto w-full text-muted-foreground'
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke='currentColor'
              strokeOpacity={0.15}
            />
            <text
              x={PAD.left - 6}
              y={y(tick) + 3}
              textAnchor='end'
              fontSize={10}
              fill='currentColor'
            >
              {tick}
            </text>
          </g>
        ))}
        {labelIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 6}
            textAnchor='middle'
            fontSize={10}
            fill='currentColor'
          >
            {formatDay(points[index].day)}
          </text>
        ))}
        {SERIES.map((series) => (
          <g key={series.key}>
            {points.length > 1 ? (
              <polyline
                fill='none'
                stroke={series.color}
                strokeWidth={series.width}
                strokeLinecap='round'
                strokeLinejoin='round'
                points={points
                  .map(
                    (point, index) =>
                      `${x(index).toFixed(1)},${y(point[series.key]).toFixed(1)}`,
                  )
                  .join(' ')}
              />
            ) : null}
            {points.map((point, index) => (
              <circle
                key={point.day}
                cx={x(index)}
                cy={y(point[series.key])}
                r={series.key === 'overall' ? 3 : 2}
                fill={series.color}
              >
                <title>{`${series.label} em ${formatDay(point.day)}: ${point[series.key]}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className='flex flex-wrap gap-x-4 gap-y-1 text-xs'>
        {SERIES.map((series) => (
          <span key={series.key} className='inline-flex items-center gap-1.5'>
            <span
              aria-hidden
              className='h-0.5 w-4 rounded-full'
              style={{ background: series.color }}
            />
            {series.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
