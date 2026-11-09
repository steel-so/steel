import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '@/src/__tests__/component-utils'
import { SdSettingsNav, sdSettingsNavGroups } from '../sd-settings-nav'
import { SD_SETTINGS_TABS } from '../settings-tabs'

/**
 * The 24 sections moved out of the second bar inside the screen and into the
 * module context rail, grouped. What must not happen is a section becoming
 * unreachable along the way: that is what these cases pin down.
 */

const BASE = '/acme/servicedesk'

vi.mock('next/navigation', () => ({
  usePathname: () => `${BASE}/settings`,
  useSearchParams: () => new URLSearchParams('tab=sla'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

describe('sdSettingsNavGroups()', () => {
  it('places every registered tab exactly once, keeping the registry order', () => {
    const groups = sdSettingsNavGroups()
    const ids = groups.flatMap((group) => group.tabs.map((tab) => tab.id))

    expect(ids).toHaveLength(SD_SETTINGS_TABS.length)
    expect(new Set(ids).size).toBe(SD_SETTINGS_TABS.length)
    for (const group of groups) {
      const positions = group.tabs.map((tab) => SD_SETTINGS_TABS.indexOf(tab))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  it('does not hide a tab nobody listed: it falls into "Outros"', () => {
    const extra = {
      ...SD_SETTINGS_TABS[0],
      id: 'brand-new',
      label: 'Novidade',
    }
    const groups = sdSettingsNavGroups([...SD_SETTINGS_TABS, extra])

    expect(groups.at(-1)).toMatchObject({ label: 'Outros' })
    expect(groups.at(-1)?.tabs.map((tab) => tab.id)).toEqual(['brand-new'])
  })

  it('has no group left without a tab', () => {
    for (const group of sdSettingsNavGroups()) {
      expect(group.tabs.length).toBeGreaterThan(0)
    }
  })
})

describe('<SdSettingsNav />', () => {
  it('links every section by ?tab= and offers the way back to the module', () => {
    const { container } = renderWithQuery(<SdSettingsNav base={BASE} />)

    expect(
      screen
        .getByRole('link', { name: /Voltar ao ServiceDesk/ })
        .getAttribute('href'),
    ).toBe(BASE)

    const hrefs = [...container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    )
    const open = sdSettingsNavGroups().find((group) =>
      group.tabs.some((tab) => tab.id === 'sla'),
    )
    expect(open?.tabs.length).toBeGreaterThan(1)
    for (const tab of open?.tabs ?? []) {
      expect(hrefs).toContain(`${BASE}/settings?tab=${tab.id}`)
    }
  })

  it('lists every section under a titled group, none collapsed', () => {
    const { container } = renderWithQuery(<SdSettingsNav base={BASE} />)

    const hrefs = [...container.querySelectorAll('a')].map((a) =>
      a.getAttribute('href'),
    )
    for (const tab of SD_SETTINGS_TABS) {
      expect(hrefs).toContain(`${BASE}/settings?tab=${tab.id}`)
    }
    for (const group of sdSettingsNavGroups()) {
      expect(screen.getAllByText(group.label).length).toBeGreaterThan(0)
    }
  })

  it('marks the section from the query string as the current one', () => {
    renderWithQuery(<SdSettingsNav base={BASE} />)

    const current = screen
      .getAllByRole('button')
      .filter((node) => node.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('SLA')
  })
})
