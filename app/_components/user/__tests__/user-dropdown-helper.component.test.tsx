import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SUPPORT_MAILTO, UserDropdownHelper } from '../user-dropdown-helper'

async function openMenu() {
  render(<UserDropdownHelper />)
  fireEvent.click(screen.getByRole('button', { name: 'Ajuda' }))
  return screen.findByRole('menuitem', { name: /Falar com o suporte/ })
}

function linkOf(item: HTMLElement) {
  return item.closest('a')?.getAttribute('href')
}

describe('<UserDropdownHelper />', () => {
  it('should send support to the real support inbox, not a placeholder', async () => {
    const support = await openMenu()
    expect(linkOf(support)).toBe(SUPPORT_MAILTO)
    expect(SUPPORT_MAILTO).toBe('mailto:suporte@stratustelecom.com.br')
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs.some((h) => h?.includes('google.com'))).toBe(false)
  })

  it('should link every entry to a real destination', async () => {
    await openMenu()
    expect(linkOf(screen.getByRole('menuitem', { name: /Documentação/ }))).toBe(
      '/docs',
    )
    expect(
      linkOf(screen.getByRole('menuitem', { name: /Contatar vendas/ })),
    ).toBe('mailto:sales@stratustelecom.com.br')
    expect(
      linkOf(screen.getByRole('menuitem', { name: /O que há de novo/ })),
    ).toBe('/changelog')
    expect(
      linkOf(screen.getByRole('menuitem', { name: /Status do sistema/ })),
    ).toBe('/status')
  })
})
