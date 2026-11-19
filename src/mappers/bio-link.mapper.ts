import type { BioLink } from '@prisma/client'
import { parseBioBlocks, parseBioTheme } from '@/src/schemas/bio-link.schema'
import type {
  BioLinkDTO,
  BioLinkPublicDTO,
  BioLinkSummaryDTO,
} from '@/types/bio-link'

export function toBioLinkDTO(row: BioLink, url: string): BioLinkDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    title: row.title,
    description: row.description,
    avatarUrl: row.avatarUrl,
    theme: parseBioTheme(row.theme),
    blocks: parseBioBlocks(row.blocks),
    noIndex: row.noIndex,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    url,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toBioLinkSummaryDTO(
  row: BioLink,
  url: string,
  totals: { views: number; clicks: number },
): BioLinkSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    avatarUrl: row.avatarUrl,
    url,
    linkCount: parseBioBlocks(row.blocks).filter(
      (block) => block.type === 'link' || block.type === 'video',
    ).length,
    views: totals.views,
    clicks: totals.clicks,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toBioLinkPublicDTO(row: BioLink): BioLinkPublicDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    slug: row.slug,
    title: row.title?.trim() || row.name,
    description: row.description,
    avatarUrl: row.avatarUrl,
    theme: parseBioTheme(row.theme),
    blocks: parseBioBlocks(row.blocks),
    noIndex: row.noIndex,
  }
}
