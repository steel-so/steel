/**
 * Columns written whenever a conversation (re)enters the queue without an
 * assignee: the queue clock restarts and the "still unattended" reminder of
 * the previous streak is forgotten, so each streak gets its own reminder
 * (ADR 0047).
 */
export function queueEntry(now: Date = new Date()): {
  queuedAt: Date
  unassignedReminderAt: null
} {
  return { queuedAt: now, unassignedReminderAt: null }
}
