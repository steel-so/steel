import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SdRequesterWhatsappSection } from '../requester-whatsapp-section'

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({
  notify: { error: notifyError, success: vi.fn() },
}))

type Props = Parameters<typeof SdRequesterWhatsappSection>[0]

function setup(props: Partial<Props>) {
  const onSave = vi.fn()
  render(
    <SdRequesterWhatsappSection
      saved={{}}
      canEdit
      pending={false}
      onSave={onSave}
      {...props}
    />,
  )
  return onSave
}

describe('<SdRequesterWhatsappSection />', () => {
  it('lists only the customer-facing events', () => {
    setup({})
    expect(screen.getByText('Chamado resolvido')).toBeTruthy()
    expect(screen.queryByText('Chamado atribuído a você')).toBeNull()
  })

  it('saves the template with the variables in the chosen order', () => {
    const onSave = setup({})
    const save = screen.getByRole('button', { name: 'Salvar avisos' })
    expect((save as HTMLButtonElement).disabled).toBe(true)

    const [name] = screen.getAllByLabelText('Modelo aprovado')
    fireEvent.change(name, { target: { value: 'chamado_resolvido' } })
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Resumo do aviso' })[0],
    )
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Código do chamado' })[0],
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar avisos' }))

    const saved = onSave.mock.calls[0][0]
    const [entry] = Object.values(saved) as {
      templateName: string
      language: string
      variables: string[]
    }[]
    expect(entry).toEqual({
      templateName: 'chamado_resolvido',
      language: 'pt_BR',
      variables: ['headline', 'code'],
    })
  })

  it('removes a variable and the whole entry when the name is cleared', () => {
    const onSave = setup({
      saved: {
        'ticket.resolved': {
          templateName: 'resolvido',
          language: 'pt_BR',
          variables: ['code'],
        },
      },
    })
    fireEvent.click(
      screen.getByRole('button', { name: '1. Código do chamado' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Salvar avisos' }))
    expect(onSave.mock.calls[0][0]['ticket.resolved'].variables).toEqual([])

    const input = screen.getByDisplayValue('resolvido')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar avisos' }))
    expect(onSave.mock.calls[1][0]).toEqual({})
  })

  it('asks for the language before saving', () => {
    const onSave = setup({
      saved: {
        'ticket.resolved': {
          templateName: 'resolvido',
          language: 'pt_BR',
          variables: [],
        },
      },
    })
    fireEvent.change(screen.getByDisplayValue('pt_BR'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar avisos' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalled()
  })

  it('is read-only without edit permission', () => {
    setup({ canEdit: false })
    expect(screen.queryByRole('button', { name: 'Salvar avisos' })).toBeNull()
    expect(
      (screen.getAllByLabelText('Modelo aprovado')[0] as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })
})
