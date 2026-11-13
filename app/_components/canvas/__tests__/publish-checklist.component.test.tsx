import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PublishCheckItem } from '@/src/lib/canvas/checklist'
import { PublishChecklist } from '../checklist/publish-checklist'

const ERROR: PublishCheckItem = {
  code: 'FORM_NO_DESTINATION',
  level: 'error',
  message: 'Formulário sem destino',
  nodeId: 'n1',
  documentId: 'p1',
  documentName: 'Contato',
}
const WARNING: PublishCheckItem = {
  code: 'IMAGE_ALT_MISSING',
  level: 'warning',
  message: 'Imagem sem texto alternativo',
}

describe('<PublishChecklist />', () => {
  it('shows the all-clear when there is nothing to fix', () => {
    render(<PublishChecklist items={[]} okTitle='Tudo certo' />)
    expect(screen.getByText('Tudo certo')).toBeTruthy()
    expect(screen.queryByTestId('publish-checklist')).toBeNull()
  })

  it('lists errors before warnings with their hints', () => {
    render(<PublishChecklist items={[WARNING, ERROR]} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0].getAttribute('data-level')).toBe('error')
    expect(rows[0].textContent).toContain('Contato · Impede a publicação')
    expect(rows[1].textContent).toContain('Recomendado corrigir')
  })

  it('makes items with a target clickable only when onPick is given', () => {
    const onPick = vi.fn()
    const { rerender } = render(
      <PublishChecklist items={[ERROR, WARNING]} onPick={onPick} />,
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onPick).toHaveBeenCalledWith(ERROR)
    rerender(<PublishChecklist items={[ERROR, WARNING]} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
