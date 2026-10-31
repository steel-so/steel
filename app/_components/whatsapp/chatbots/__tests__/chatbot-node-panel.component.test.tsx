import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatbotNode } from '@/src/schemas/whatsapp-chatbot.schema'
import { ChatbotNodePanel } from '../chatbot-node-panel'

const base = {
  variables: ['contact_name', 'nome'],
  teams: [{ id: 't1', name: 'Suporte' }],
  agents: [{ id: 'u1', name: 'Ana' }],
  readOnly: false,
}

function menuNode(count: number): ChatbotNode {
  return {
    id: 'menu',
    type: 'menu',
    position: { x: 0, y: 0 },
    data: {
      text: 'Escolha',
      options: Array.from({ length: count }, (_, i) => ({
        id: `o${i}`,
        label: `Op ${i + 1}`,
      })),
      maxAttempts: 2,
    },
  }
}

describe('<ChatbotNodePanel />', () => {
  it('adds a menu option and blocks removing below the minimum', () => {
    const onChange = vi.fn()
    render(
      <ChatbotNodePanel
        {...base}
        node={menuNode(2)}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar opção' }))
    expect(onChange.mock.calls[0][0].options).toHaveLength(3)
    for (const button of screen.getAllByRole('button', {
      name: 'Remover opção',
    })) {
      expect((button as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('stops adding options at the limit', () => {
    render(
      <ChatbotNodePanel
        {...base}
        node={menuNode(10)}
        onChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(
      (
        screen.getByRole('button', {
          name: 'Adicionar opção',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('appends a variable chip to the message text', () => {
    const onChange = vi.fn()
    render(
      <ChatbotNodePanel
        {...base}
        node={{
          id: 'm',
          type: 'message',
          position: { x: 0, y: 0 },
          data: { text: 'Oi ' },
        }}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('{{nome}}'))
    expect(onChange).toHaveBeenCalledWith({ text: 'Oi {{nome}}' })
  })

  describe('send form block', () => {
    const formNode = (data = {}): ChatbotNode => ({
      id: 'f',
      type: 'send-form',
      position: { x: 0, y: 0 },
      data: { flowId: 'flow-1', ...data },
    })

    it('shows the chosen form and edits the message, button and fallback', () => {
      const onChange = vi.fn()
      render(
        <ChatbotNodePanel
          {...base}
          flows={[{ id: 'flow-1', name: 'Cadastro', sendable: true }]}
          node={formNode({ bodyText: 'Oi ', fallbackText: 'Link ' })}
          onChange={onChange}
          onDelete={vi.fn()}
        />,
      )
      expect(screen.getByText('Cadastro')).toBeTruthy()

      fireEvent.change(screen.getByLabelText('Texto do botão (opcional)'), {
        target: { value: 'Abrir' },
      })
      expect(onChange).toHaveBeenLastCalledWith({
        flowId: 'flow-1',
        bodyText: 'Oi ',
        fallbackText: 'Link ',
        ctaLabel: 'Abrir',
      })

      // Both texts offer the variable chips; the first one is the message.
      fireEvent.click(screen.getAllByText('{{nome}}')[0])
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ bodyText: 'Oi {{nome}}' }),
      )
      fireEvent.click(screen.getAllByText('{{nome}}')[1])
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ fallbackText: 'Link {{nome}}' }),
      )
    })

    it('clears an optional field that was emptied', () => {
      const onChange = vi.fn()
      render(
        <ChatbotNodePanel
          {...base}
          flows={[{ id: 'flow-1', name: 'Cadastro', sendable: true }]}
          node={formNode({ ctaLabel: 'Abrir' })}
          onChange={onChange}
          onDelete={vi.fn()}
        />,
      )
      fireEvent.change(screen.getByLabelText('Texto do botão (opcional)'), {
        target: { value: '' },
      })
      expect(onChange).toHaveBeenCalledWith({
        flowId: 'flow-1',
        ctaLabel: undefined,
      })
    })

    it('says so when there is no form to send, and flags a retired one', () => {
      const { rerender } = render(
        <ChatbotNodePanel
          {...base}
          node={formNode({ flowId: '' })}
          onChange={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      expect(screen.getByText(/Nenhum formulário publicado/)).toBeTruthy()

      rerender(
        <ChatbotNodePanel
          {...base}
          flows={[{ id: 'flow-1', name: 'Antigo', sendable: false }]}
          node={formNode()}
          onChange={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      expect(
        screen.getAllByText('Antigo (indisponível)').length,
      ).toBeGreaterThan(0)
    })

    it('locks the fields when read only', () => {
      render(
        <ChatbotNodePanel
          {...base}
          readOnly
          flows={[{ id: 'flow-1', name: 'Cadastro', sendable: true }]}
          node={formNode()}
          onChange={vi.fn()}
          onDelete={vi.fn()}
        />,
      )
      expect(
        (screen.getByLabelText('Texto do botão (opcional)') as HTMLInputElement)
          .disabled,
      ).toBe(true)
    })
  })

  it('deletes a block, but never the start block, and hides it when read only', () => {
    const onDelete = vi.fn()
    const message: ChatbotNode = {
      id: 'm',
      type: 'message',
      position: { x: 0, y: 0 },
      data: { text: 'x' },
    }
    const { rerender } = render(
      <ChatbotNodePanel
        {...base}
        node={message}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Excluir bloco' }))
    expect(onDelete).toHaveBeenCalled()

    rerender(
      <ChatbotNodePanel
        {...base}
        node={{ id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} }}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir bloco' })).toBeNull()

    rerender(
      <ChatbotNodePanel
        {...base}
        readOnly
        node={message}
        onChange={vi.fn()}
        onDelete={onDelete}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Excluir bloco' })).toBeNull()
  })

  it('removes a condition branch only while more than one remains', () => {
    const onChange = vi.fn()
    render(
      <ChatbotNodePanel
        {...base}
        node={{
          id: 'c',
          type: 'condition',
          position: { x: 0, y: 0 },
          data: {
            branches: [
              { id: 'a', variable: 'nome', operator: 'equals', value: 'x' },
              { id: 'b', variable: 'nome', operator: 'is_empty', value: '' },
            ],
          },
        }}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Remover ramo' })[0])
    expect(
      onChange.mock.calls[0][0].branches.map((b: { id: string }) => b.id),
    ).toEqual(['b'])
  })
})
