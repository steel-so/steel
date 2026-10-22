import {
  crmCompetitorProfileNotFound,
  crmSocialOauthFailed,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { getJson } from '../providers/http'
import type { DiscoveredPost, DiscoveredProfile, OwnMetrics } from './types'

const GRAPH = 'https://graph.facebook.com/v26.0'

function toInt(value: unknown): number {
  const n =
    typeof value === 'string' ? Number.parseInt(value, 10) : Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Métricas da PRÓPRIA conta IG conectada (sem o truque de Business Discovery). */
export async function fetchInstagramOwnMetrics(
  pageToken: string,
  igAccountId: string,
): Promise<Result<OwnMetrics>> {
  const params = new URLSearchParams({ fields: 'followers_count,media_count' })
  const result = await getJson<{
    followers_count?: number
    media_count?: number
  }>(`${GRAPH}/${igAccountId}?${params.toString()}`, pageToken)
  if (!result.ok) return result

  return ok({
    followersCount: toInt(result.value.followers_count),
    postsCount:
      result.value.media_count != null ? toInt(result.value.media_count) : null,
  })
}

type BusinessDiscoveryResponse = {
  business_discovery?: {
    followers_count?: number
    media_count?: number
    biography?: string
    profile_picture_url?: string
    name?: string
    username?: string
  }
}

/**
 * Métricas públicas de OUTRA conta IG Business/Creator via Business
 * Discovery — usa o token da nossa própria conta conectada para ler dados
 * públicos de um concorrente, sem ele precisar autorizar nada. Só funciona
 * para contas Business/Creator: contas pessoais, privadas ou inexistentes
 * fazem a Graph API devolver HTTP 400 (`"Invalid user id"`, code 110), não
 * um 200 sem o campo — por isso o 400 aqui vira `crmCompetitorProfileNotFound`
 * em vez do erro genérico de OAuth. Outros status (401/403/5xx) continuam
 * como falha real de conexão.
 */
export async function fetchInstagramPublicProfile(
  pageToken: string,
  ownIgAccountId: string,
  handle: string,
): Promise<Result<DiscoveredProfile>> {
  const username = handle.trim().replace(/^@/, '')
  const params = new URLSearchParams({
    fields: `business_discovery.username(${username}){followers_count,media_count,biography,profile_picture_url,name,username}`,
  })
  const url = `${GRAPH}/${ownIgAccountId}?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${pageToken}` },
    })
  } catch (error) {
    console.error('[social] GET erro de rede', url, error)
    return err(crmSocialOauthFailed())
  }

  if (!response.ok) {
    if (response.status === 400) return err(crmCompetitorProfileNotFound())
    console.error(
      '[social] GET falhou',
      url,
      response.status,
      (await response.text().catch(() => '')).slice(0, 500),
    )
    return err(crmSocialOauthFailed())
  }

  const data = (await response.json()) as BusinessDiscoveryResponse
  const bd = data.business_discovery
  if (!bd) return err(crmCompetitorProfileNotFound())

  return ok({
    externalName: bd.name ?? (bd.username ? `@${bd.username}` : null),
    avatarUrl: bd.profile_picture_url ?? null,
    bio: bd.biography ?? null,
    followersCount: toInt(bd.followers_count),
    postsCount: bd.media_count != null ? toInt(bd.media_count) : null,
    profileUrl: bd.username ? `https://www.instagram.com/${bd.username}` : null,
  })
}

export type TodayEngagementStats = {
  postsCount: number
  totalLikes: number
  totalComments: number
}

function isToday(iso: string): boolean {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return false
  const now = new Date()
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  )
}

type BusinessDiscoveryMediaResponse = {
  business_discovery?: {
    media?: {
      data?: {
        media_type?: string
        timestamp?: string
        like_count?: number
        comments_count?: number
      }[]
    }
  }
}

/**
 * Posts (feed/reels/carrossel — sem stories) publicados hoje por OUTRA conta
 * Business/Creator, via o campo aninhado `media` do Business Discovery.
 * Mesma limitação de `fetchInstagramPublicProfile` (só contas Business/
 * Creator públicas); stories de terceiros não têm API pública nenhuma, então
 * ficam de fora — só o feed entra na contagem, pros dois lados da comparação
 * (concorrente e conta própria) ficarem no mesmo critério.
 */
export async function fetchCompetitorTodayEngagement(
  pageToken: string,
  ownIgAccountId: string,
  handle: string,
): Promise<Result<TodayEngagementStats>> {
  const username = handle.trim().replace(/^@/, '')
  const params = new URLSearchParams({
    fields: `business_discovery.username(${username}){media.limit(50){media_type,timestamp,like_count,comments_count}}`,
  })
  const url = `${GRAPH}/${ownIgAccountId}?${params.toString()}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${pageToken}` },
    })
  } catch (error) {
    console.error('[social] GET erro de rede', url, error)
    return err(crmSocialOauthFailed())
  }

  if (!response.ok) {
    if (response.status === 400) return err(crmCompetitorProfileNotFound())
    console.error(
      '[social] GET falhou',
      url,
      response.status,
      (await response.text().catch(() => '')).slice(0, 500),
    )
    return err(crmSocialOauthFailed())
  }

  const data = (await response.json()) as BusinessDiscoveryMediaResponse
  const media = data.business_discovery?.media?.data
  if (!media) return err(crmCompetitorProfileNotFound())

  const today = media.filter((m) => m.timestamp && isToday(m.timestamp))
  return ok({
    postsCount: today.length,
    totalLikes: today.reduce((sum, m) => sum + toInt(m.like_count), 0),
    totalComments: today.reduce((sum, m) => sum + toInt(m.comments_count), 0),
  })
}

/** Posts kept per collection run — Graph returns newest first. */
const POSTS_PAGE_SIZE = 50

const POST_FIELDS =
  'id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink'

type GraphMediaItem = {
  id?: string
  caption?: string
  media_type?: string
  media_product_type?: string
  timestamp?: string
  like_count?: number
  comments_count?: number
  permalink?: string
}

export function toInstagramFormat(
  item: Pick<GraphMediaItem, 'media_type' | 'media_product_type'>,
): DiscoveredPost['format'] {
  if (item.media_product_type === 'REELS') return 'REELS'
  if (item.media_type === 'CAROUSEL_ALBUM') return 'CAROUSEL'
  if (item.media_type === 'VIDEO') return 'VIDEO'
  return 'IMAGE'
}

/**
 * Feed posts only: stories have no public API for third parties, so they
 * are dropped on both sides to keep the comparison on the same basis.
 * Graph omits `like_count` when the owner hides likes — kept as `null`.
 */
export function toInstagramPosts(items: GraphMediaItem[]): DiscoveredPost[] {
  const posts: DiscoveredPost[] = []
  for (const item of items) {
    if (!item.id || !item.timestamp) continue
    if (item.media_product_type === 'STORY') continue
    const publishedAt = new Date(item.timestamp)
    if (Number.isNaN(publishedAt.getTime())) continue
    posts.push({
      externalId: item.id,
      format: toInstagramFormat(item),
      caption: item.caption ?? null,
      permalink: item.permalink ?? null,
      likeCount: item.like_count != null ? toInt(item.like_count) : null,
      commentsCount:
        item.comments_count != null ? toInt(item.comments_count) : null,
      viewCount: null,
      publishedAt,
    })
  }
  return posts
}

/**
 * Latest public posts of ANOTHER Business/Creator account through the nested
 * `media` field of Business Discovery (same limits as
 * `fetchInstagramPublicProfile`).
 */
export async function fetchInstagramCompetitorPosts(
  pageToken: string,
  ownIgAccountId: string,
  handle: string,
): Promise<Result<DiscoveredPost[]>> {
  const username = handle.trim().replace(/^@/, '')
  const params = new URLSearchParams({
    fields: `business_discovery.username(${username}){media.limit(${POSTS_PAGE_SIZE}){${POST_FIELDS}}}`,
  })
  const result = await getJson<{
    business_discovery?: { media?: { data?: GraphMediaItem[] } }
  }>(`${GRAPH}/${ownIgAccountId}?${params.toString()}`, pageToken)
  if (!result.ok) return result

  const media = result.value.business_discovery?.media?.data
  if (!media) return err(crmCompetitorProfileNotFound())
  return ok(toInstagramPosts(media))
}

/** Latest posts of the workspace's own connected IG account. */
export async function fetchInstagramOwnPosts(
  pageToken: string,
  igAccountId: string,
): Promise<Result<DiscoveredPost[]>> {
  const params = new URLSearchParams({
    fields: POST_FIELDS,
    limit: String(POSTS_PAGE_SIZE),
  })
  const result = await getJson<{ data?: GraphMediaItem[] }>(
    `${GRAPH}/${igAccountId}/media?${params.toString()}`,
    pageToken,
  )
  if (!result.ok) return result
  return ok(toInstagramPosts(result.value.data ?? []))
}
