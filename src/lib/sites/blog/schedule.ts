/**
 * Publication state of a blog post. A post goes live by itself (no site
 * publish): PUBLISHED with a past date is public, SCHEDULED waits for its
 * date (the worker flips it, and the runtime already treats a due one as
 * live, so a late worker never delays it).
 */

export type PostStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'

export interface PublicationInput {
  status: PostStatus
  /** Requested publication date (`null` clears it). */
  publishedAt?: Date | null
}

export interface PublicationState {
  status: PostStatus
  publishedAt: Date | null
}

export type PublicationResult =
  | ({ ok: true } & PublicationState)
  | { ok: false; message: string }

/**
 * State to store for a requested status: publishing with a future date
 * schedules, scheduling with a past date publishes, a draft keeps its
 * previous date. Publishing without a date keeps the one the post had
 * (republishing keeps the original date); `publishedAt: null` means now.
 */
export function resolvePublication(
  input: PublicationInput,
  current: PublicationState | null,
  now: Date,
): PublicationResult {
  const requested =
    input.publishedAt === undefined ? undefined : input.publishedAt
  if (input.status === 'DRAFT') {
    return {
      ok: true,
      status: 'DRAFT',
      publishedAt:
        requested === undefined ? (current?.publishedAt ?? null) : requested,
    }
  }
  if (input.status === 'SCHEDULED') {
    const date = requested ?? current?.publishedAt ?? null
    if (!date) {
      return { ok: false, message: 'Informe a data de publicação' }
    }
    return {
      ok: true,
      status: date.getTime() > now.getTime() ? 'SCHEDULED' : 'PUBLISHED',
      publishedAt: date,
    }
  }
  // `null` publishes now; absent keeps the date it already had.
  const date =
    requested === null ? now : (requested ?? current?.publishedAt ?? now)
  return {
    ok: true,
    status: date.getTime() > now.getTime() ? 'SCHEDULED' : 'PUBLISHED',
    publishedAt: date,
  }
}

/** The post is public now. */
export function isPostLive(state: PublicationState, now: Date): boolean {
  if (state.status === 'DRAFT' || !state.publishedAt) return false
  return state.publishedAt.getTime() <= now.getTime()
}
