import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { createEmptySiteDocument } from '@/src/lib/sites/document'
import { toSiteGlobalDTO } from '@/src/mappers/site.mapper'
import { SiteGlobalRepository } from '@/src/repositories/site-global.repository'
import type {
  CreateSiteGlobalDTO,
  UpdateSiteGlobalDTO,
} from '@/src/schemas/site-global.schema'
import type { SiteGlobalDTO } from '@/types/site'
import { authorizeSite } from './site-access'
import { assertAdminOnlyAllowed, checkSiteDocument } from './site-page.service'

/** Abuse guard: header + footer + symbols. */
export const MAX_GLOBALS_PER_SITE = 50

export const SiteGlobalService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteGlobalDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const globals = await SiteGlobalRepository.listBySite(siteId)
    if (!globals.ok) return globals
    return ok(globals.value.map(toSiteGlobalDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    globalId: string,
  ): Promise<Result<SiteGlobalDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const global = await SiteGlobalRepository.findById(globalId, siteId)
    if (!global.ok) return global
    return ok(toSiteGlobalDTO(global.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteGlobalDTO,
  ): Promise<Result<SiteGlobalDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const total = await SiteGlobalRepository.countByKind(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_GLOBALS_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_GLOBALS_PER_SITE} componentes globais`,
        ),
      )
    }
    if (dto.kind !== 'SYMBOL') {
      const sameKind = await SiteGlobalRepository.countByKind(siteId, dto.kind)
      if (!sameKind.ok) return sameKind
      if (sameKind.value > 0) {
        return err(
          appError(
            'SITE_GLOBAL_KIND_TAKEN',
            dto.kind === 'HEADER'
              ? 'Este site já tem um cabeçalho'
              : 'Este site já tem um rodapé',
          ),
        )
      }
    }

    const document = checkSiteDocument(
      dto.document ?? createEmptySiteDocument(),
    )
    if (!document.ok) return document
    const allowed = await assertAdminOnlyAllowed(
      actorId,
      workspaceId,
      document.value,
      async () => ok(null),
    )
    if (!allowed.ok) return allowed

    const created = await SiteGlobalRepository.create({
      siteId,
      kind: dto.kind,
      name: dto.name,
      document: document.value,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'site_global',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, kind: dto.kind },
    })
    return ok(toSiteGlobalDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    globalId: string,
    dto: UpdateSiteGlobalDTO,
  ): Promise<Result<SiteGlobalDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const existing = await SiteGlobalRepository.findById(globalId, siteId)
    if (!existing.ok) return existing

    let document: Prisma.InputJsonValue | undefined
    if (dto.document !== undefined) {
      const checked = checkSiteDocument(dto.document)
      if (!checked.ok) return checked
      const allowed = await assertAdminOnlyAllowed(
        actorId,
        workspaceId,
        checked.value,
        async () => ok(existing.value.document),
      )
      if (!allowed.ok) return allowed
      document = checked.value
    }

    const updated = await SiteGlobalRepository.update(globalId, {
      name: dto.name,
      document,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'site_global',
      action: 'update',
      actorId,
      targetId: globalId,
      meta: { siteId, fields: Object.keys(dto) },
    })
    return ok(toSiteGlobalDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    globalId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const existing = await SiteGlobalRepository.findById(globalId, siteId)
    if (!existing.ok) return existing

    const removed = await SiteGlobalRepository.delete(globalId)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'site_global',
      action: 'delete',
      actorId,
      targetId: globalId,
      meta: { siteId },
    })
    return ok(undefined)
  },
}
