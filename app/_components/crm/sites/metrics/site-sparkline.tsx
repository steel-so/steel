import { VIZ } from '@/app/_components/steel-ai-usage/usage-charts'

/**
 * Daily views of a site as a tiny line (the list cards). One series, so
 * no legend: the text beside it names it. The color variable comes from
 * `VIZ_VARS` on an ancestor.
 */
export function SiteSparkline({
  values,
  label,
  width = 96,
  height = 28,
}: {
  values: number[]
  label: string
  width?: number
  height?: number
}) {
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const pad = 2
  const points = values
    .map((value, index) => {
      const x = index * step
      const y = pad + (height - pad * 2) * (1 - value / max)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      role='img'
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className='shrink-0 overflow-visible'
    >
      <line
        x1={0}
        x2={width}
        y1={height - pad}
        y2={height - pad}
        stroke='currentColor'
        strokeOpacity={0.12}
      />
      {values.length > 1 ? (
        <polyline
          points={points}
          fill='none'
          stroke={VIZ.mine}
          strokeWidth={2}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      ) : null}
    </svg>
  )
}
