/**
 * Swarming rules that need no I/O: limits and the Slack channel name.
 */

/** Specialists in a single swarm (invitations included). */
export const SD_SWARM_MAX_MEMBERS = 10

/** Slack limit for a channel name. */
const SLACK_NAME_MAX = 80

/**
 * Slack channel name for a swarm: lowercase letters, digits and hyphens
 * only (`INC-000123` -> `swarm-inc-000123`). `salt` makes the retry after a
 * `name_taken` answer unique.
 */
export function sdSwarmChannelName(code: string, salt?: string): string {
  const slug = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = `swarm-${slug || 'ticket'}${salt ? `-${salt}` : ''}`
  return base.slice(0, SLACK_NAME_MAX)
}
