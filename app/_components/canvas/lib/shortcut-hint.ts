import { formatKeysText } from '@/src/lib/shortcuts/keys'
import { getShortcut, shortcutKeys } from '@/src/lib/shortcuts/registry'

function onMac(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  )
}

/**
 * Text of the first key combination of a registered shortcut for the
 * current platform (`Ctrl+Z`, `⌘Z`). The registry is the only place that
 * knows the keys; tooltips and menus read them from here.
 */
export function shortcutHint(id: string): string {
  const mac = onMac()
  const keys = shortcutKeys(getShortcut(id), mac)[0]
  return keys ? formatKeysText(keys, mac) : ''
}
