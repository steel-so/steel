import type { Prisma, SitePage } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { forbidden } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { SITE_ADMIN_ONLY_TYPES } from '@/src/lib/canvas-site'
import { err, ok, type Result } from '@/src/lib/result'
import {
  createEmptySiteDocument,
  validateSiteDocument,
} from '@/src/lib/sites/document'
import { joinPagePath, pageSlugFromTitle } from '@/src/lib/sites/slug'
import { toSitePageDTO, toSitePageSummaryDTO } from '@/src/mappers/site.mapper'
import {
  SitePageRepository,
  type SitePageSummary,
} from '@/src/repositories/site-page.repository'
import type {
  CreateSitePageDTO,
  DuplicateSitePageDTO,
  UpdateSitePageDTO,
} from '@/src/schemas/site-page.schema'
import type { SitePageDTO, SitePageSummaryDTO } from '@/types/site'
import { assertModulePrivileged } from './authz'
import { authorizeSite } from './site-access'

/** Abuse guards. */
export const MAX_PAGES_PER_SITE = 200
/** `/servicos/consultoria/remota` at most. */
export const MAX_PAGE_DEPTH = 3
const SLUG_ATTEMPTS = 50

const json = (value: unknown) => value as Prisma.InputJsonValue

const protectedPage = (message: string) =>
  appError('SITE_PAGE_PROTECTED', message)

/** Validated document, or SITE_DOCUMENT_INVALID with every problem. */
export function checkSiteDocument(
  input: unknown,
): Result<Prisma.InputJsonValue> {
  const checked = validateSiteDocument(input)
  if (!checked.ok) {
    return err(
      appError(
        'SITE_DOCUMENT_INVALID',
        'O documento da página é inválido',
        checked.error,
      ),
    )
  }
  return ok(json(checked.value))
}

function depthOf(pages: SitePageSummary[], pageId: string | null): number {
  let depth = 0
  let current = pageId
  while (current) {
    depth += 1
    const id = current
    current = pages.find((page) => page.id === id)?.parentId ?? null
  }
  return depth
}

function isDescendant(
  pages: SitePageSummary[],
  candidateId: string,
  ancestorId: string,
): boolean {
  let current: string | null = candidateId
  while (current) {
    if (current === ancestorId) return true
    const id: string = current
    current = pages.find((page) => page.id === id)?.parentId ?? null
  }
  return false
}

/** First slug free under `parentPath` (`contato`, `contato-2`…). */
function freeSlug(
  pages: SitePageSummary[],
  parentPath: string | null,
  base: string,
): string {
  const used = new Set(pages.map((page) => page.path))
  for (let attempt = 1; attempt <= SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`
    if (!used.has(joinPagePath(parentPath, slug))) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

function parentPathOf(
  pages: SitePageSummary[],
  parentId: string | null,
): string | null {
  if (!parentId) return null
  return pages.find((page) => page.id === parentId)?.path ?? null
}

/** Admin-only nodes (`site.embed`) of a document, by id → props JSON. */
function adminOnlyNodes(doc: unknown): Map<string, string> {
  const nodes = (doc as { nodes?: Record<string, CanvasNode> } | null)?.nodes
  const found = new Map<string, string>()
  for (const node of Object.values(nodes ?? {})) {
    if (SITE_ADMIN_ONLY_TYPES.includes(node.type)) {
      found.set(node.id, JSON.stringify(node.props))
    }
  }
  return found
}

/**
 * Admin-only elements (embedded code) can only be added or changed by
 * workspace OWNER/ADMIN. Ones already in the document (`previous`) may stay
 * untouched when a member edits the rest of the page.
 */
export async function assertAdminOnlyAllowed(
  actorId: string,
  workspaceId: string,
  next: unknown,
  previous: () => Promise<Result<unknown>>,
): Promise<Result<true>> {
  const incoming = adminOnlyNodes(next)
  if (incoming.size === 0) return ok(true)
  const before = await previous()
  if (!before.ok) return before
  const known = adminOnlyNodes(before.value)
  const changed = [...incoming].some(([id, props]) => known.get(id) !== props)
  if (!changed) return ok(true)
  const privileged = await assertModulePrivileged(actorId, workspaceId, 'CRM')
  if (!privileged.ok) {
    return err(
      forbidden(
        'Só administradores podem adicionar ou editar código incorporado',
      ),
    )
  }
  return ok(true)
}

const NO_PREVIOUS = async (): Promise<Result<unknown>> => ok(null)

async function loadPages(siteId: string): Promise<Result<SitePageSummary[]>> {
  return SitePageRepository.listBySite(siteId)
}

export const SitePageService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SitePageSummaryDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const pages = await loadPages(siteId)
    if (!pages.ok) return pages
    return ok(pages.value.map(toSitePageSummaryDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    pageId: string,
  ): Promise<Result<SitePageDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const page = await SitePageRepository.findById(pageId, siteId)
    if (!page.ok) return page
    return ok(toSitePageDTO(page.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSitePageDTO,
  ): Promise<Result<SitePageDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const pages = await loadPages(siteId)
    if (!pages.ok) return pages
    if (pages.value.length >= MAX_PAGES_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_PAGES_PER_SITE} páginas`,
        ),
      )
    }

    const parentId = dto.parentId ?? null
    if (parentId && !pages.value.some((page) => page.id === parentId)) {
      return err(appError('SITE_PAGE_NOT_FOUND', 'Página mãe não encontrada'))
    }
    if (depthOf(pages.value, parentId) + 1 > MAX_PAGE_DEPTH) {
      return err(
        protectedPage(`Use no máximo ${MAX_PAGE_DEPTH} níveis de páginas`),
      )
    }

    const document = checkSiteDocument(
      dto.document ?? createEmptySiteDocument(),
    )
    if (!document.ok) return document
    const allowed = await assertAdminOnlyAllowed(
      actorId,
      workspaceId,
      document.value,
      NO_PREVIOUS,
    )
    if (!allowed.ok) return allowed

    const parentPath = parentPathOf(pages.value, parentId)
    const slug =
      dto.slug ??
      freeSlug(pages.value, parentPath, pageSlugFromTitle(dto.title))

    const created = await SitePageRepository.create({
      siteId,
      parentId,
      title: dto.title,
      slug,
      path: joinPagePath(parentPath, slug),
      document: document.value,
      seo: json(dto.seo ?? {}),
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'site_page',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId },
    })
    return ok(toSitePageDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    pageId: string,
    dto: UpdateSitePageDTO,
  ): Promise<Result<SitePageDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const pages = await loadPages(siteId)
    if (!pages.ok) return pages
    const current = pages.value.find((page) => page.id === pageId)
    if (!current) {
      return err(appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada'))
    }

    let document: Prisma.InputJsonValue | undefined
    if (dto.document !== undefined) {
      const checked = checkSiteDocument(dto.document)
      if (!checked.ok) return checked
      const allowed = await assertAdminOnlyAllowed(
        actorId,
        workspaceId,
        checked.value,
        async () => {
          const page = await SitePageRepository.findById(pageId, siteId)
          return page.ok ? ok(page.value.document) : page
        },
      )
      if (!allowed.ok) return allowed
      document = checked.value
    }

    const parentId =
      dto.parentId === undefined ? current.parentId : dto.parentId
    if (parentId !== current.parentId && parentId !== null) {
      if (!pages.value.some((page) => page.id === parentId)) {
        return err(appError('SITE_PAGE_NOT_FOUND', 'Página mãe não encontrada'))
      }
      if (isDescendant(pages.value, parentId, pageId)) {
        return err(protectedPage('Uma página não pode ficar dentro dela mesma'))
      }
    }

    const slug = dto.slug ?? current.slug
    const path = joinPagePath(parentPathOf(pages.value, parentId), slug)
    const descendants = pages.value.filter((page) =>
      page.path.startsWith(`${current.path}/`),
    )
    if (path !== current.path) {
      const subtreeDepth = Math.max(
        0,
        ...descendants.map(
          (page) =>
            page.path.split('/').length - current.path.split('/').length,
        ),
      )
      if (depthOf(pages.value, parentId) + 1 + subtreeDepth > MAX_PAGE_DEPTH) {
        return err(
          protectedPage(`Use no máximo ${MAX_PAGE_DEPTH} níveis de páginas`),
        )
      }
    }

    const updated = await SitePageRepository.update(
      pageId,
      {
        title: dto.title,
        slug: dto.slug,
        parentId: dto.parentId,
        path: path === current.path ? undefined : path,
        document,
        seo: dto.seo === undefined ? undefined : json(dto.seo),
      },
      path === current.path
        ? []
        : descendants.map((page) => ({
            id: page.id,
            path: `${path}${page.path.slice(current.path.length)}`,
          })),
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'site_page',
      action: 'update',
      actorId,
      targetId: pageId,
      meta: { siteId, fields: Object.keys(dto) },
    })
    return ok(toSitePageDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    pageId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const pages = await loadPages(siteId)
    if (!pages.ok) return pages
    const page = pages.value.find((candidate) => candidate.id === pageId)
    if (!page) {
      return err(appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada'))
    }
    if (page.isHome || site.value.homePageId === pageId) {
      return err(
        protectedPage('Escolha outra página inicial antes de excluir esta'),
      )
    }
    if (pages.value.some((candidate) => candidate.parentId === pageId)) {
      return err(
        protectedPage('Mova ou exclua as subpáginas antes de excluir esta'),
      )
    }

    const removed = await SitePageRepository.delete(pageId)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'site_page',
      action: 'delete',
      actorId,
      targetId: pageId,
      meta: { siteId },
    })
    return ok(undefined)
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    siteId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const pages = await loadPages(siteId)
    if (!pages.ok) return pages
    const known = new Set(pages.value.map((page) => page.id))
    if (orderedIds.some((id) => !known.has(id))) {
      return err(appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada'))
    }

    const reordered = await SitePageRepository.reorder(siteId, orderedIds)
    if (!reordered.ok) return reordered

    auditMutation({
      entity: 'site_page',
      action: 'reorder',
      actorId,
      targetId: siteId,
    })
    return ok(undefined)
  },

  /** Copy of a page right under the same parent, never the home page. */
  async duplicate(
    actorId: string,
    workspaceId: string,
    siteId: string,
    pageId: string,
    dto: DuplicateSitePageDTO,
  ): Promise<Result<SitePageDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const [source, pages] = await Promise.all([
      SitePageRepository.findById(pageId, siteId),
      loadPages(siteId),
    ])
    if (!source.ok) return source
    if (!pages.ok) return pages
    if (pages.value.length >= MAX_PAGES_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_PAGES_PER_SITE} páginas`,
        ),
      )
    }

    const original: SitePage = source.value
    const parentPath = parentPathOf(pages.value, original.parentId)
    const slug = freeSlug(pages.value, parentPath, `${original.slug}-copia`)

    const created = await SitePageRepository.create({
      siteId,
      parentId: original.parentId,
      title: dto.title ?? `${original.title} (cópia)`,
      slug,
      path: joinPagePath(parentPath, slug),
      document: json(original.document),
      seo: json(original.seo),
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'site_page',
      action: 'duplicate',
      actorId,
      targetId: created.value.id,
      meta: { siteId, sourceId: pageId },
    })
    return ok(toSitePageDTO(created.value))
  },
}
