'use client'

import { ResponsiveLine } from '@nivo/line'

/** Tiny trend line (client-side history), same nivo base as the metrics page. */
export function ServerSparkline({
  values,
  color = '#6366f1',
  max,
  label,
}: {
  values: number[]
  color?: string
  /** Fixed y ceiling (e.g. 100 for percentages); auto when omitted. */
  max?: number
  label: string
}) {
  if (values.length < 2) {
    return <div className='h-10' aria-hidden />
  }
  return (
    <div className='h-10 min-w-0' role='img' aria-label={label}>
      <ResponsiveLine
        data={[{ id: label, data: values.map((y, x) => ({ x, y })) }]}
        margin={{ top: 3, right: 2, bottom: 3, left: 2 }}
        colors={[color]}
        curve='monotoneX'
        lineWidth={1.5}
        pointSize={0}
        enableGridX={false}
        enableGridY={false}
        axisBottom={null}
        axisLeft={null}
        isInteractive={false}
        animate={false}
        yScale={{ type: 'linear', min: 0, max: max ?? 'auto' }}
      />
    </div>
  )
}
