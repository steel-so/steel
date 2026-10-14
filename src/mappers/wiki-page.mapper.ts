import type { Value } from 'platejs'
import type { WikiPageDTO, WikiPublicPageDTO } from '@/types/wiki-page'
import type {
  WikiPage,
  WikiPagePerson,
} from '../repositories/wiki-page.repository'
import { withTimestamps } from './_shared'

/** Viewer-relative fields of a page DTO, computed by the service. */
export interface WikiPageViewer {
  canManageLock: boolean
  isFavorite: boolean
}

function toPerson(person: WikiPagePerson | null) {
  return person
    ? { id: person.id, name: person.name, image: person.image }
    : null
}

export function toWikiPageDTO(
  wikiPage: WikiPage,
  viewer: WikiPageViewer,
): WikiPageDTO {
  return {
    id: wikiPage.id,
    workspaceId: wikiPage.workspaceId,
    parentId: wikiPage.parentId,
    title: wikiPage.title,
    icon: wikiPage.icon,
    coverImage: wikiPage.coverImage,
    content: wikiPage.content as Value,
    position: wikiPage.position,
    labelIds: wikiPage.labels.map((label) => label.labelId),
    createdById: wikiPage.createdById,
    updatedById: wikiPage.updatedById,
    archivedAt: wikiPage.archivedAt?.toISOString() ?? null,
    publishedAt: wikiPage.publishedAt?.toISOString() ?? null,
    publicToken: wikiPage.publicToken,
    lockedAt: wikiPage.lockedAt?.toISOString() ?? null,
    lockedById: wikiPage.lockedById,
    canManageLock: viewer.canManageLock,
    isFavorite: viewer.isFavorite,
    createdBy: toPerson(wikiPage.createdBy),
    updatedBy: toPerson(wikiPage.updatedBy),
    ...withTimestamps(wikiPage),
  }
}

/**
 * The public (anonymous) view of a published page. `content` and
 * `coverImage` are passed in already rewritten (media URLs pointing at the
 * public media proxy).
 */
export function toWikiPublicPageDTO(
  wikiPage: WikiPage,
  media: { content: Value; coverImage: string | null },
): WikiPublicPageDTO {
  return {
    title: wikiPage.title,
    icon: wikiPage.icon,
    coverImage: media.coverImage,
    content: media.content,
    publishedAt: (wikiPage.publishedAt ?? wikiPage.updatedAt).toISOString(),
    updatedAt: wikiPage.updatedAt.toISOString(),
  }
}
