import type { CrmBanner } from '@prisma/client'
import {
  BANNER_OBJECTIVES,
  type BannerDocument,
  BannerDocumentSchema,
  type BannerObjective,
} from '@/src/schemas/crm-banner.schema'
import type { CrmBannerDTO, CrmBannerListItemDTO } from '@/types/crm-banner'

/** Documento vazio usado quando o JSON salvo não passa mais na validação. */
const EMPTY_DOCUMENT: BannerDocument = {
  version: 1,
  formats: [
    {
      formatId: 'meta-1080x1080',
      width: 1080,
      height: 1080,
      background: { kind: 'color', color: '#ffffff' },
      elements: [],
    },
  ],
}

function readDocument(raw: unknown): BannerDocument {
  const parsed = BannerDocumentSchema.safeParse(raw)
  return parsed.success ? parsed.data : EMPTY_DOCUMENT
}

function readObjective(value: string | null): BannerObjective | null {
  return (BANNER_OBJECTIVES as readonly string[]).includes(value ?? '')
    ? (value as BannerObjective)
    : null
}

export function toCrmBannerDTO(banner: CrmBanner): CrmBannerDTO {
  return {
    id: banner.id,
    workspaceId: banner.workspaceId,
    name: banner.name,
    folder: banner.folder,
    tags: banner.tags,
    objective: readObjective(banner.objective),
    document: readDocument(banner.document),
    createdById: banner.createdById,
    updatedById: banner.updatedById,
    createdAt: banner.createdAt.toISOString(),
    updatedAt: banner.updatedAt.toISOString(),
  }
}

/** The list carries only the cover format: thumbnails do not need the rest. */
export function toCrmBannerListItemDTO(
  banner: CrmBanner,
): CrmBannerListItemDTO {
  const dto = toCrmBannerDTO(banner)
  const [cover] = dto.document.formats
  return {
    ...dto,
    document: {
      version: 1,
      formats: cover ? [cover] : dto.document.formats,
    },
    formatCount: dto.document.formats.length,
    formatIds: dto.document.formats.map((format) => format.formatId),
  }
}
