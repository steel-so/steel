import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WhatsappNumberBadge } from '../whatsapp-number-badge'

describe('<WhatsappNumberBadge />', () => {
  it('shows "Tem WhatsApp" for a number that has it', () => {
    render(<WhatsappNumberBadge hasWhatsapp />)
    expect(screen.getByText('Tem WhatsApp').getAttribute('data-state')).toBe(
      'yes',
    )
  })

  it('shows "Sem WhatsApp" for a number that does not', () => {
    render(<WhatsappNumberBadge hasWhatsapp={false} />)
    expect(screen.getByText('Sem WhatsApp').getAttribute('data-state')).toBe(
      'no',
    )
  })

  it('shows "Não verificado" when never checked', () => {
    render(<WhatsappNumberBadge hasWhatsapp={null} />)
    expect(screen.getByText('Não verificado').getAttribute('data-state')).toBe(
      'unknown',
    )
  })

  it('tells when it was checked, in the Brasília time zone', () => {
    render(
      <WhatsappNumberBadge hasWhatsapp checkedAt='2026-10-22T15:30:00.000Z' />,
    )
    expect(screen.getByText('Tem WhatsApp').getAttribute('title')).toContain(
      '12:30',
    )
  })
})
