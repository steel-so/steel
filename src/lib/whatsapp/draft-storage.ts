/**
 * Per-conversation composer drafts (text only) kept in the browser, so
 * switching conversations or reloading never loses — or leaks — a half
 * written message. Storage can be missing or blocked: every access is
 * guarded and the composer works without it.
 */
function draftKey(workspaceId: string, conversationId: string): string {
  return `steel:zap-draft:${workspaceId}:${conversationId}`
}

export function readDraft(workspaceId: string, conversationId: string): string {
  try {
    return window.localStorage.getItem(draftKey(workspaceId, conversationId)) ?? ''
  } catch {
    return ''
  }
}

/** An empty draft removes the entry. */
export function writeDraft(
  workspaceId: string,
  conversationId: string,
  text: string,
): void {
  try {
    const key = draftKey(workspaceId, conversationId)
    if (text.trim()) window.localStorage.setItem(key, text)
    else window.localStorage.removeItem(key)
  } catch {
    // Private mode / blocked storage: the draft just is not persisted.
  }
}
