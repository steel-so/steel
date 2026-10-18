/**
 * Reciprocal rank fusion (Cormack et al., 2009) of the full-text and the
 * vector rankings of the knowledge search. Pure.
 *
 * score(chunk) = Σ over rankings of 1 / (k + rank), rank starting at 1.
 * RRF ignores the raw scores (ts_rank and cosine similarity are not on the
 * same scale) and rewards chunks both rankings agree on. `k = 60` is the
 * value from the paper and the usual default.
 */

export const RRF_K = 60

export interface RankedChunk {
  id: string
  sourceType: string
  sourceId: string
}

export interface FusedChunk<T extends RankedChunk> {
  chunk: T
  score: number
  /** 1-based rank in each list it appeared in. */
  ranks: { text?: number; vector?: number }
}

export function fuseRankings<T extends RankedChunk>(
  text: readonly T[],
  vector: readonly T[],
  k = RRF_K,
): FusedChunk<T>[] {
  const fused = new Map<string, FusedChunk<T>>()
  const add = (list: readonly T[], key: 'text' | 'vector') => {
    list.forEach((chunk, index) => {
      const rank = index + 1
      const entry = fused.get(chunk.id) ?? { chunk, score: 0, ranks: {} }
      if (entry.ranks[key] !== undefined) return
      entry.ranks[key] = rank
      entry.score += 1 / (k + rank)
      fused.set(chunk.id, entry)
    })
  }
  add(text, 'text')
  add(vector, 'vector')
  return [...fused.values()].sort(
    (a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
  )
}

/**
 * One result per source: the best-scored chunk represents it (a page that
 * matches in five chunks must not take five of the slots). Keeps the
 * fused order.
 */
export function bestChunkPerSource<T extends RankedChunk>(
  fused: readonly FusedChunk<T>[],
  limit: number,
): FusedChunk<T>[] {
  const seen = new Set<string>()
  const out: FusedChunk<T>[] = []
  for (const entry of fused) {
    const key = `${entry.chunk.sourceType}:${entry.chunk.sourceId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
    if (out.length >= limit) break
  }
  return out
}

/** Snippet of a chunk around the first query word it contains. */
export function snippetAround(
  content: string,
  words: readonly string[],
  max = 320,
): string {
  const text = content.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const folded = fold(text)
  let at = -1
  for (const word of words) {
    const needle = fold(word)
    if (needle.length < 3) continue
    const found = folded.indexOf(needle)
    if (found !== -1 && (at === -1 || found < at)) at = found
  }
  const start = at <= 0 ? 0 : Math.max(0, at - Math.floor(max / 3))
  const slice = text.slice(start, start + max).trim()
  return `${start > 0 ? '…' : ''}${slice}${start + max < text.length ? '…' : ''}`
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
