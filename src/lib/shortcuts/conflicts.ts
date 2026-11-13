import { normalizeKeys, parseSequence } from './keys'
import {
  type ShortcutDefinition,
  scopesCoActive,
  shortcutKeys,
} from './registry'

/**
 * Combos the browser or the OS keeps (or that users rely on) — never bound.
 * `mod` is Ctrl on Windows/Linux and ⌘ on macOS, so these hold for both.
 */
const RESERVED_COMMON = [
  'mod+w',
  'mod+t',
  'mod+n',
  'mod+q',
  'mod+r',
  'mod+l',
  'mod+d',
  'mod+h',
  'mod+j',
  'mod+p',
  'mod+f',
  'mod+g',
  'mod+tab',
  'mod+shift+n',
  'mod+shift+t',
  'mod+shift+w',
  'mod+shift+p',
  'mod+shift+i',
  'mod+shift+j',
  'mod+shift+c',
  'mod+shift+delete',
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => `mod+${n}`),
  'f5',
  'f11',
  'f12',
]

export const RESERVED_PC = new Set(
  [...RESERVED_COMMON, 'alt+arrowleft', 'alt+arrowright', 'alt+f4'].map(
    normalizeKeys,
  ),
)

export const RESERVED_MAC = new Set(
  [
    ...RESERVED_COMMON,
    'mod+space',
    'mod+m',
    'mod+arrowleft',
    'mod+arrowright',
    'mod+[',
    'mod+]',
  ].map(normalizeKeys),
)

export type ShortcutConflict = {
  kind:
    | 'duplicate-id'
    | 'missing-label'
    | 'duplicate-keys'
    | 'prefix'
    | 'reserved'
    | 'ctrl-alt'
  ids: string[]
  keys?: string
}

function shadowed(a: ShortcutDefinition, b: ShortcutDefinition): boolean {
  return Boolean(a.shadows?.includes(b.id) || b.shadows?.includes(a.id))
}

function allKeys(entry: ShortcutDefinition): string[] {
  return [...new Set([...entry.keys, ...shortcutKeys(entry, true)])]
}

/**
 * Static checks over the registry. Returns every problem found; the unit
 * test asserts the list is empty, so CI fails on a bad new entry.
 */
export function findShortcutConflicts(
  entries: readonly ShortcutDefinition[],
): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = []

  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      conflicts.push({ kind: 'duplicate-id', ids: [entry.id] })
    }
    seen.add(entry.id)
    if (!entry.label.trim() || entry.label === entry.id) {
      conflicts.push({ kind: 'missing-label', ids: [entry.id] })
    }

    for (const keys of entry.keys) {
      if (!entry.overridesBrowser && RESERVED_PC.has(parseFirst(keys))) {
        conflicts.push({ kind: 'reserved', ids: [entry.id], keys })
      }
      // Ctrl+Alt is AltGr on Windows (ABNT2 types ¹²³£¢¬ with it).
      if (
        parseSequence(keys).some(
          (stroke) => (stroke.mod || stroke.ctrl) && stroke.alt,
        )
      ) {
        conflicts.push({ kind: 'ctrl-alt', ids: [entry.id], keys })
      }
    }
    for (const keys of shortcutKeys(entry, true)) {
      if (!entry.overridesBrowser && RESERVED_MAC.has(parseFirst(keys))) {
        conflicts.push({ kind: 'reserved', ids: [entry.id], keys })
      }
    }
  }

  for (const entry of entries) {
    if (new Set(entry.keys).size !== entry.keys.length) {
      conflicts.push({ kind: 'duplicate-keys', ids: [entry.id] })
    }
  }

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]
      const b = entries[j]
      if (!scopesCoActive(a.scope, b.scope)) continue
      for (const ka of allKeys(a)) {
        for (const kb of allKeys(b)) {
          if (ka === kb && !shadowed(a, b)) {
            conflicts.push({
              kind: 'duplicate-keys',
              ids: [a.id, b.id],
              keys: ka,
            })
          }
          // `g` alone would make `g c` wait or never fire.
          if (kb.startsWith(`${ka} `) || ka.startsWith(`${kb} `)) {
            conflicts.push({
              kind: 'prefix',
              ids: [a.id, b.id],
              keys: `${ka} / ${kb}`,
            })
          }
        }
      }
    }
  }

  return conflicts
}

function parseFirst(keys: string): string {
  return keys.trim().split(/\s+/)[0]
}
