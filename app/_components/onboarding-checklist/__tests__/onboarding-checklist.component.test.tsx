import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  OnboardingChecklist,
  type OnboardingChecklistItem,
} from '../onboarding-checklist'

function item(
  overrides: Partial<OnboardingChecklistItem> = {},
): OnboardingChecklistItem {
  return {
    key: 'a',
    title: 'Conectar um número',
    description: 'Para enviar mensagens.',
    href: '/acme/settings/whatsapp',
    actionLabel: 'Conectar',
    done: false,
    ...overrides,
  }
}

describe('<OnboardingChecklist />', () => {
  it('shows pending steps with a link and the progress counter', () => {
    render(
      <OnboardingChecklist
        title='Primeiros passos'
        description='Siga a ordem.'
        items={[item(), item({ key: 'b', title: 'Importar', done: true })]}
      />,
    )
    expect(screen.getByText('1 de 2')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Conectar' })
    expect(link.getAttribute('href')).toBe('/acme/settings/whatsapp')
    // A finished step has no action button.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('renders nothing once every step is done', () => {
    const { container } = render(
      <OnboardingChecklist
        title='Primeiros passos'
        description='Siga a ordem.'
        items={[item({ done: true })]}
      />,
    )
    expect(container.textContent).toBe('')
  })

  it('hides the action of a step that is still loading', () => {
    render(
      <OnboardingChecklist
        title='Primeiros passos'
        description='Siga a ordem.'
        items={[item({ loading: true })]}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })
})
