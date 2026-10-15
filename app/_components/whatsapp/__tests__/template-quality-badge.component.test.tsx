import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  TemplateNameWithQuality,
  TemplateQualityBadge,
  TemplateStatusBadge,
} from '../template-quality-badge'

describe('<TemplateQualityBadge />', () => {
  it.each([
    ['GREEN', 'Qualidade alta', 'bg-emerald-500'],
    ['YELLOW', 'Qualidade média', 'bg-amber-400'],
    ['RED', 'Qualidade baixa', 'bg-destructive'],
    ['UNKNOWN', 'Qualidade ainda não avaliada', 'bg-muted-foreground/40'],
  ] as const)(
    'renders %s as a labelled colored square',
    (quality, label, fill) => {
      render(<TemplateQualityBadge quality={quality} />)
      const square = screen.getByRole('img', { name: label })
      expect(square.dataset.quality).toBe(quality)
      expect(square.className).toContain(fill)
      expect(square.className).toContain('rounded-[3px]')
    },
  )

  it('explains the risk in a tooltip', async () => {
    render(<TemplateQualityBadge quality='RED' />)
    const square = screen.getByRole('img', { name: 'Qualidade baixa' })
    fireEvent.focus(square)
    fireEvent.mouseEnter(square)
    fireEvent.pointerEnter(square)
    expect(
      await screen.findByText(/Risco de a Meta pausar ou desativar/),
    ).toBeTruthy()
  })

  it('falls back to unknown for an unexpected rating', () => {
    render(<TemplateQualityBadge quality={'BLUE' as unknown as 'GREEN'} />)
    expect(
      screen.getByRole('img', { name: 'Qualidade ainda não avaliada' }),
    ).toBeTruthy()
  })
})

describe('<TemplateStatusBadge />', () => {
  it('translates the status', () => {
    render(<TemplateStatusBadge status='APPROVED' />)
    expect(screen.getByText('Aprovado')).toBeTruthy()
  })

  it('shows the reason of a paused template in a tooltip', async () => {
    render(<TemplateStatusBadge status='PAUSED' reason='Pausado por 3h' />)
    const badge = screen.getByText('Pausado')
    fireEvent.focus(badge.parentElement as HTMLElement)
    fireEvent.mouseEnter(badge.parentElement as HTMLElement)
    fireEvent.pointerEnter(badge.parentElement as HTMLElement)
    expect(await screen.findByText('Pausado por 3h')).toBeTruthy()
  })
})

describe('<TemplateNameWithQuality />', () => {
  it('shows the name, the square and a non-approved status', () => {
    render(
      <TemplateNameWithQuality
        name='cobranca'
        quality='YELLOW'
        status='DISABLED'
      />,
    )
    expect(screen.getByText('cobranca')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Qualidade média' })).toBeTruthy()
    expect(screen.getByText('· Desativado')).toBeTruthy()
  })

  it('omits the status when approved', () => {
    render(
      <TemplateNameWithQuality name='ok' quality='GREEN' status='APPROVED' />,
    )
    expect(screen.queryByText(/Aprovado/)).toBeNull()
  })
})
