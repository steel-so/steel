import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FunnelChart } from '@/app/_components/crm/dashboard/widgets/funnel-chart'
import { ChartConfigSchema } from '@/src/schemas/crm-dashboard.schema'

const config = ChartConfigSchema.parse({
  chartType: 'funnel',
  source: 'leads',
  xField: 'stage',
})

const steps = [
  { label: 'Qualificados', value: 40 },
  { label: 'Leads', value: 100 },
  { label: 'Ganhos', value: 10 },
]

describe('FunnelChart', () => {
  it('orders the steps from the largest to the smallest by default', () => {
    render(
      <FunnelChart
        steps={steps}
        config={config}
        palette={['#000']}
        tv={false}
      />,
    )
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(labels[0]).toContain('Leads')
    expect(labels[1]).toContain('Qualificados')
    expect(labels[2]).toContain('Ganhos')
  })

  it('shows the conversion between consecutive steps and from the first', () => {
    render(
      <FunnelChart
        steps={steps}
        config={config}
        palette={['#000']}
        tv={false}
      />,
    )
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('10% da 1ª etapa')).toBeTruthy()
  })

  it('renders a dash instead of dividing by zero', () => {
    render(
      <FunnelChart
        steps={[
          { label: 'A', value: 0 },
          { label: 'B', value: 0 },
        ]}
        config={config}
        palette={['#000']}
        tv={false}
      />,
    )
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('highlights a card on hover', () => {
    render(
      <FunnelChart
        steps={steps}
        config={config}
        palette={['#000']}
        tv={false}
      />,
    )
    const card = screen.getAllByRole('button')[1]
    fireEvent.mouseEnter(card)
    expect(card.className).toContain('bg-primary/10')
  })
})
