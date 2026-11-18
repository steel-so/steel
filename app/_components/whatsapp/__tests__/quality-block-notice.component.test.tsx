import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { whatsappQualityBlocked } from '@/src/errors'
import { QUALITY_BLOCK_PREFIX } from '@/src/lib/whatsapp/quality-block'
import { QualityBlockNotice } from '../quality-block-notice'

describe('<QualityBlockNotice />', () => {
  it('shows the quality title and the capitalised reason without the prefix', () => {
    render(
      <QualityBlockNotice
        reason={`${QUALITY_BLOCK_PREFIX} o número desta conexão está com qualidade "Baixa".`}
      />,
    )

    expect(
      screen.getByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeTruthy()
    expect(
      screen.getByText('O número desta conexão está com qualidade "Baixa".'),
    ).toBeTruthy()
    expect(screen.queryByText(new RegExp(QUALITY_BLOCK_PREFIX))).toBeNull()
  })

  it.each(['BROADCAST', 'NEWSLETTER', 'CRM_CAMPAIGN'] as const)(
    'renders the %s refusal produced by the gate',
    (sender) => {
      const { message } = whatsappQualityBlocked('NUMBER', undefined, sender)
      render(<QualityBlockNotice reason={message} />)

      expect(screen.getByRole('alert')).toBeTruthy()
      expect(
        screen.getByText(/O número desta conexão está com qualidade/),
      ).toBeTruthy()
    },
  )

  it.each([null, undefined, '', 'Preencha as variáveis: nome'])(
    'renders nothing for %j',
    (reason) => {
      const { container } = render(<QualityBlockNotice reason={reason} />)

      expect(container.textContent).toBe('')
    },
  )
})
