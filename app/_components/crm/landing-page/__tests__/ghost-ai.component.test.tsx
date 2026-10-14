import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AiTextarea } from '@/components/ui/ai-text-field'
import {
  type GhostAiAssist,
  GhostAiProvider,
  GhostAiSection,
} from '@/components/ui/ghost-ai'
import { GhostInput } from '@/components/ui/ghost-input'

function ControlledTextarea({ onValue }: { onValue: (v: string) => void }) {
  const [value, setValue] = useState('Texto antigo')
  return (
    <AiTextarea
      aiLabel='Condições de pagamento'
      value={value}
      onChange={(e) => {
        setValue(e.target.value)
        onValue(e.target.value)
      }}
    />
  )
}

describe('GhostAiProvider', () => {
  it('opens the chat from a field, sends the request and applies the suggestion', async () => {
    const assist = vi.fn<GhostAiAssist>().mockResolvedValue({
      reply: 'Deixei mais direto.',
      suggestion: 'Pagamento em 30 dias',
    })
    const onValue = vi.fn()
    render(
      <GhostAiProvider assist={assist}>
        <GhostAiSection value='Condições comerciais'>
          <ControlledTextarea onValue={onValue} />
        </GhostAiSection>
      </GhostAiProvider>,
    )

    fireEvent.focus(screen.getByDisplayValue('Texto antigo'))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ajustar texto com IA' }),
    )
    fireEvent.click(await screen.findByText('Deixe mais curto'))

    await screen.findByText('Deixei mais direto.')
    expect(assist).toHaveBeenCalledWith({
      text: 'Texto antigo',
      messages: [{ role: 'user', content: 'Deixe mais curto' }],
      field: {
        label: 'Condições de pagamento',
        multiline: true,
        maxLength: undefined,
      },
      section: 'Condições comerciais',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar no campo' }))
    await waitFor(() =>
      expect(onValue).toHaveBeenCalledWith('Pagamento em 30 dias'),
    )
    expect(screen.getByDisplayValue('Pagamento em 30 dias')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Aplicado/ })).toBeTruthy()
  })

  it('commits a GhostInput suggestion and shows request errors inline', async () => {
    const assist = vi
      .fn<GhostAiAssist>()
      .mockRejectedValueOnce(new Error('Cota mensal de IA esgotada'))
      .mockResolvedValueOnce({ reply: 'Pronto.', suggestion: 'Novo título' })
    const onCommit = vi.fn()
    render(
      <GhostAiProvider assist={assist}>
        <GhostInput
          value='Título'
          onCommit={onCommit}
          placeholder='Título principal'
          maxLength={80}
        />
      </GhostAiProvider>,
    )

    fireEvent.pointerEnter(screen.getByDisplayValue('Título'))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ajustar texto com IA' }),
    )
    const box = await screen.findByRole('textbox', {
      name: 'Mensagem para a IA',
    })
    fireEvent.change(box, { target: { value: 'Mais forte' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('Cota mensal de IA esgotada')

    fireEvent.change(box, { target: { value: 'Tenta de novo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await screen.findByText('Pronto.')
    expect(assist.mock.calls[1][0].field).toEqual({
      label: 'Título principal',
      multiline: false,
      maxLength: 80,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Aplicar no campo' }))
    expect(onCommit).toHaveBeenCalledWith('Novo título')
  })

  it('renders no AI button without a provider or in read-only mode', () => {
    render(
      <>
        <GhostInput value='Sem provedor' onCommit={vi.fn()} />
        <GhostAiProvider assist={vi.fn()}>
          <GhostInput value='Somente leitura' onCommit={vi.fn()} readOnly />
        </GhostAiProvider>
      </>,
    )
    fireEvent.focus(screen.getByDisplayValue('Sem provedor'))
    fireEvent.pointerEnter(screen.getByText('Somente leitura'))
    expect(
      screen.queryByRole('button', { name: 'Ajustar texto com IA' }),
    ).toBeNull()
  })
})
