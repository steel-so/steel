import { describe, expect, it } from 'vitest'
import {
  findShortcutConflicts,
  RESERVED_MAC,
  RESERVED_PC,
} from '@/src/lib/shortcuts/conflicts'
import { normalizeKeys } from '@/src/lib/shortcuts/keys'
import {
  displayKeys,
  getShortcut,
  groupShortcuts,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type ShortcutDefinition,
  scopesCoActive,
  searchShortcuts,
  shortcutKeys,
} from '@/src/lib/shortcuts/registry'

function entry(
  partial: Partial<ShortcutDefinition> & { id: string },
): ShortcutDefinition {
  return {
    keys: ['x'],
    scope: 'global',
    group: 'actions',
    label: 'Ação de teste',
    priority: 'P1',
    ...partial,
  }
}

describe('shortcut registry', () => {
  it('has no conflicts (duplicates, prefixes, reserved combos, Ctrl+Alt)', () => {
    expect(findShortcutConflicts(SHORTCUTS)).toEqual([])
  })

  it('stores keys normalized', () => {
    for (const shortcut of SHORTCUTS) {
      for (const keys of [...shortcut.keys, ...(shortcut.macKeys ?? [])]) {
        expect(normalizeKeys(keys)).toBe(keys)
      }
    }
  })

  it('every entry has a pt-BR label, a known group and a priority in scope', () => {
    const groups = new Set(SHORTCUT_GROUPS.map((g) => g.id))
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.length).toBeGreaterThan(2)
      expect(groups.has(shortcut.group)).toBe(true)
      expect(['P1', 'P2']).toContain(shortcut.priority)
    }
  })

  it('keeps the migrated shortcuts', () => {
    expect(getShortcut('global.search').keys).toEqual(['mod+k'])
    expect(getShortcut('list.new').keys).toEqual(['n'])
    expect(getShortcut('list.search').keys).toEqual(['/'])
    const inbox = SHORTCUTS.filter((s) => s.scope === 'inbox')
    // 13 inbox shortcuts: 12 here + the global `?`.
    expect(inbox).toHaveLength(12)
    expect(getShortcut('global.shortcuts').keys).toEqual(['?'])
  })

  it('documents the Canvas select-all and nudge keys', () => {
    expect(getShortcut('canvas.select-all').keys).toEqual(['mod+a'])
    expect(getShortcut('canvas.select-all').scope).toBe('editor.canvas')
    expect(getShortcut('canvas.nudge').keys).toContain('arrowleft')
    expect(getShortcut('canvas.nudge-big').keys).toEqual([
      'shift+arrowup',
      'shift+arrowdown',
      'shift+arrowleft',
      'shift+arrowright',
    ])
    expect(getShortcut('canvas.nudge').shadows).toContain(
      'canvas.select-sibling',
    )
  })

  it('moves editor headings off Ctrl+Alt on Windows/Linux only', () => {
    const heading = getShortcut('editor.heading')
    expect(shortcutKeys(heading, false)[0]).toBe('mod+shift+1')
    expect(shortcutKeys(heading, true)[0]).toBe('mod+alt+1')
    expect(displayKeys(heading, false)).toEqual(['mod+shift+1', 'mod+shift+6'])
    expect(displayKeys(getShortcut('list.next'), false)).toEqual([
      'j',
      'arrowdown',
    ])
  })

  it('throws on an unknown id', () => {
    expect(() => getShortcut('nope')).toThrow(/Unknown shortcut/)
  })
})

describe('scopesCoActive', () => {
  it('relates scopes that can share a screen', () => {
    expect(scopesCoActive('global', 'list')).toBe(true)
    expect(scopesCoActive('list', 'servicedesk.board')).toBe(true)
    expect(scopesCoActive('crm.record', 'list')).toBe(true)
  })

  it('separates modules, exclusions and documentation-only scopes', () => {
    expect(scopesCoActive('servicedesk', 'crm')).toBe(false)
    expect(scopesCoActive('servicedesk.ticket', 'list')).toBe(false)
    expect(scopesCoActive('list', 'inbox')).toBe(false)
    expect(scopesCoActive('editor', 'global')).toBe(false)
  })
})

describe('findShortcutConflicts', () => {
  it('flags duplicate ids and missing labels', () => {
    const result = findShortcutConflicts([
      entry({ id: 'a', keys: ['x'] }),
      entry({ id: 'a', keys: ['y'], label: 'a' }),
    ])
    expect(result.map((c) => c.kind)).toEqual(['duplicate-id', 'missing-label'])
  })

  it('flags the same keys in co-active scopes unless shadowed', () => {
    expect(
      findShortcutConflicts([
        entry({ id: 'a', keys: ['x'] }),
        entry({ id: 'b', keys: ['x'], scope: 'list', group: 'list' }),
      ]),
    ).toEqual([{ kind: 'duplicate-keys', ids: ['a', 'b'], keys: 'x' }])

    expect(
      findShortcutConflicts([
        entry({ id: 'a', keys: ['x'] }),
        entry({ id: 'b', keys: ['x'], scope: 'list', shadows: ['a'] }),
      ]),
    ).toEqual([])

    expect(
      findShortcutConflicts([
        entry({ id: 'a', keys: ['x'], scope: 'crm' }),
        entry({ id: 'b', keys: ['x'], scope: 'servicedesk' }),
      ]),
    ).toEqual([])
  })

  it('flags repeated keys inside one entry', () => {
    expect(
      findShortcutConflicts([entry({ id: 'a', keys: ['x', 'x'] })]),
    ).toEqual([{ kind: 'duplicate-keys', ids: ['a'] }])
  })

  it('flags a single key that is also a sequence prefix', () => {
    expect(
      findShortcutConflicts([
        entry({ id: 'a', keys: ['g'] }),
        entry({ id: 'b', keys: ['g c'], scope: 'list' }),
      ]),
    ).toEqual([{ kind: 'prefix', ids: ['a', 'b'], keys: 'g / g c' }])
  })

  it('flags reserved browser/OS combos and Ctrl+Alt', () => {
    const kinds = (keys: string[], macKeys?: string[]) =>
      findShortcutConflicts([entry({ id: 'a', keys, macKeys })]).map(
        (c) => c.kind,
      )
    expect(kinds(['mod+w'])).toEqual(['reserved', 'reserved'])
    expect(kinds(['alt+arrowleft'])).toEqual(['reserved'])
    expect(kinds(['mod+alt+1'])).toEqual(['ctrl-alt'])
    expect(kinds(['ctrl+alt+x'])).toEqual(['ctrl-alt'])
    expect(kinds(['mod+shift+1'], ['mod+space'])).toEqual(['reserved'])
    expect(kinds(['mod+shift+1'], ['mod+alt+1'])).toEqual([])
    expect(RESERVED_PC.has('mod+1')).toBe(true)
    expect(RESERVED_MAC.has('mod+m')).toBe(true)
  })
})

describe('search and grouping', () => {
  it('finds by label, group and keys ignoring accents and case', () => {
    expect(searchShortcuts(SHORTCUTS, 'NOTA INTERNA').map((s) => s.id)).toEqual(
      ['sd.ticket.note'],
    )
    expect(
      searchShortcuts(SHORTCUTS, 'comunicacao proxima').map((s) => s.id),
    ).toContain('zap.next')
    expect(searchShortcuts(SHORTCUTS, '  ')).toHaveLength(SHORTCUTS.length)
    expect(searchShortcuts(SHORTCUTS, 'zzzz-nada')).toEqual([])
  })

  it('groups in cheat-sheet order and drops empty groups', () => {
    const groups = groupShortcuts([
      getShortcut('ai.stop'),
      getShortcut('nav.home'),
    ])
    expect(groups.map((g) => g.id)).toEqual(['navigation', 'ai'])
  })
})
