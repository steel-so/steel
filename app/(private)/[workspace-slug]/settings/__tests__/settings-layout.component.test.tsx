import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import SettingsLayout from '../layout'

vi.mock('@/app/_components/navigation/sidebar-context', () => ({
  ContextSidebar: ({ children }: { children: ReactNode }) => (
    <nav>{children}</nav>
  ),
  ContextHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  NavGroup: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  NavItem: ({ href, children }: { href: string; children: ReactNode }) => (
    <li>
      <a href={href}>{children}</a>
    </li>
  ),
}))

const SETTINGS_DIR = join(
  process.cwd(),
  'app/(private)/[workspace-slug]/settings',
)

async function renderLayout() {
  const ui = await SettingsLayout({
    children: <p>conteúdo</p>,
    params: Promise.resolve({ 'workspace-slug': 'acme' }),
  })
  return render(ui)
}

describe('Settings sidebar', () => {
  it('should not link to the nonexistent Iniciativas page', async () => {
    await renderLayout()
    expect(screen.queryByText('Iniciativas')).toBeNull()
    expect(
      document.querySelector('a[href="/acme/settings/initiatives"]'),
    ).toBeNull()
  })

  it('should only link to pages that exist', async () => {
    await renderLayout()
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) =>
      a.getAttribute('href'),
    )
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      const rest = (href ?? '').replace(/^\/acme\/settings\/?/, '')
      expect(existsSync(join(SETTINGS_DIR, rest, 'page.tsx')), href ?? '').toBe(
        true,
      )
    }
  })
})
