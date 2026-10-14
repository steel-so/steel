import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { extractTemplateFillableFields } from '@/src/lib/whatsapp/template-variables'
import type { WhatsAppTemplateDTO } from '@/types/whatsapp-template'
import { TemplatePreview } from '../template-preview'
import { TemplateVariablesDialog } from '../template-variables-dialog'

const components = [
  { type: 'HEADER', format: 'TEXT', text: 'Olá {{1}}' },
  { type: 'BODY', text: 'Seu pedido {{1}} chega em {{2}}.' },
  { type: 'FOOTER', text: 'Equipe Steel' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'URL', text: 'Rastrear', url: 'https://steel.app/t/{{1}}' },
      { type: 'QUICK_REPLY', text: 'Falar com atendente' },
    ],
  },
]

function makeTemplate(
  overrides: Partial<WhatsAppTemplateDTO> = {},
): WhatsAppTemplateDTO {
  return {
    id: 'tpl_1',
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    name: 'pedido_enviado',
    language: 'pt_BR',
    category: 'UTILITY',
    status: 'APPROVED',
    components,
    quality: 'UNKNOWN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('<TemplatePreview />', () => {
  it('renders header, body with filled values, footer and buttons', () => {
    const fields = extractTemplateFillableFields(components as never)
    render(
      <TemplatePreview
        fields={fields}
        values={{ header: { 1: 'Ana' }, body: { 1: '#42' }, buttons: {} }}
      />,
    )

    expect(screen.getByText('Olá Ana')).toBeTruthy()
    // Unfilled placeholders stay visible so the user sees what is missing.
    expect(screen.getByText('Seu pedido #42 chega em {{2}}.')).toBeTruthy()
    expect(screen.getByText('Equipe Steel')).toBeTruthy()
    expect(screen.getByText('Rastrear')).toBeTruthy()
    expect(screen.getByText('Falar com atendente')).toBeTruthy()
  })

  it('shows a media placeholder for non-text headers', () => {
    const fields = extractTemplateFillableFields([
      { type: 'HEADER', format: 'IMAGE' },
      { type: 'BODY', text: 'Promoção' },
    ])
    render(
      <TemplatePreview
        fields={fields}
        values={{ header: {}, body: {}, buttons: {} }}
      />,
    )
    expect(screen.getByText('Imagem')).toBeTruthy()
    expect(screen.getByText('Promoção')).toBeTruthy()
  })
})

describe('<TemplateVariablesDialog />', () => {
  it('renders nothing without a template', () => {
    const { container } = render(
      <TemplateVariablesDialog
        template={null}
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders one input per header/body/url variable and builds the Meta payload', () => {
    const onConfirm = vi.fn()
    render(
      <TemplateVariablesDialog
        template={makeTemplate()}
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('pedido_enviado')).toBeTruthy()
    expect(within(dialog).getByText('Cabeçalho — variável 1')).toBeTruthy()
    expect(within(dialog).getByText('Variável {{1}}')).toBeTruthy()
    expect(within(dialog).getByText('Variável {{2}}')).toBeTruthy()
    expect(
      within(dialog).getByText('Botão "Rastrear" — parâmetro da URL'),
    ).toBeTruthy()

    const inputs = within(dialog).getAllByRole('textbox')
    expect(inputs).toHaveLength(4)
    fireEvent.change(inputs[0], { target: { value: 'Ana' } })
    fireEvent.change(inputs[1], { target: { value: '#42' } })
    fireEvent.change(inputs[2], { target: { value: 'amanhã' } })
    fireEvent.change(inputs[3], { target: { value: 'abc' } })

    // Live preview reflects typed values.
    expect(
      within(dialog).getByText('Seu pedido #42 chega em amanhã.'),
    ).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }))
    expect(onConfirm).toHaveBeenCalledWith([
      { type: 'header', parameters: [{ type: 'text', text: 'Ana' }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: '#42' },
          { type: 'text', text: 'amanhã' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: 'abc' }],
      },
    ])
  })

  it('disables sending while submitting and closes on cancel', () => {
    const onOpenChange = vi.fn()
    render(
      <TemplateVariablesDialog
        template={makeTemplate()}
        open
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
        isSubmitting
      />,
    )
    const send = screen.getByRole('button', { name: 'Enviar' })
    expect((send as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
