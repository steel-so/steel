/**
 * Status colors of the wiki page chrome. The design system has no semantic
 * success token (only `primary`, `destructive`, `muted`…), so the "live" green
 * lives in this one closed map, like `sd-tone.ts` does for the ServiceDesk —
 * no wiki screen writes a raw palette class on its own.
 */
export const WIKI_TONE = {
  /** "Ao vivo": the page has a public link. */
  live: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600/40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400',
  liveDot: 'bg-emerald-500',
} as const
