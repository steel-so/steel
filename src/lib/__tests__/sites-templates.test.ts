import { describe, expect, it } from 'vitest'
import { getNode } from '@/src/lib/canvas/nodes'
import { SITE_TEMPLATES } from '@/src/lib/canvas-site/presets'
import { validateSiteDocument } from '@/src/lib/sites/document'
import {
  buildSiteFromTemplate,
  buildSiteGlobal,
} from '@/src/lib/sites/templates'

describe('buildSiteFromTemplate', () => {
  it.each(SITE_TEMPLATES.map((template) => template.id))(
    'builds valid documents for "%s"',
    (id) => {
      const build = buildSiteFromTemplate(id)
      expect(build).not.toBeNull()
      if (!build) return
      for (const doc of [build.home, build.header, build.footer]) {
        if (doc) expect(validateSiteDocument(doc).ok).toBe(true)
      }
    },
  )

  it('moves the header and footer sections into div-rooted globals', () => {
    const build = buildSiteFromTemplate('agencia')
    expect(build?.header).not.toBeNull()
    expect(build?.footer).not.toBeNull()
    const header = build?.header
    if (!header) return
    expect(getNode(header, header.rootId)?.props.tag).toBe('div')
    expect(getNode(header, header.rootId)?.children).toHaveLength(1)
    const home = build?.home
    const template = SITE_TEMPLATES.find((item) => item.id === 'agencia')
    expect(home && getNode(home, home.rootId)?.children).toHaveLength(
      (template?.sections.length ?? 0) - 2,
    )
  })

  it('returns the template theme and null for an unknown id', () => {
    expect(buildSiteFromTemplate('agencia')?.theme.colors.primary).toMatch(/^#/)
    expect(buildSiteFromTemplate('nope')).toBeNull()
  })
})

describe('buildSiteGlobal', () => {
  it('builds an empty or styled header/footer', () => {
    const blank = buildSiteGlobal('HEADER')
    expect(getNode(blank, blank.rootId)?.children).toEqual([])
    expect(validateSiteDocument(blank).ok).toBe(true)
    const footer = buildSiteGlobal('FOOTER', 'saas')
    expect(getNode(footer, footer.rootId)?.children).toHaveLength(1)
    expect(validateSiteDocument(footer).ok).toBe(true)
  })
})
