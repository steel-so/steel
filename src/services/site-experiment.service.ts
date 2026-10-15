import type { Site, SiteExperiment } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { appError } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { revalidateSites } from '@/src/lib/sites/cache'
import {
  changedVariants,
  resolveAbVisitorKey,
  variantFingerprints,
} from '@/src/lib/sites/experiment-runtime'
import {
  assignVariant,
  CONTROL_KEY,
  EXPERIMENT_VARIANT_KEYS,
  type ExperimentVariant,
  evenWeights,
  isExperimentLive,
  missingVariants,
  promoteSectionVariant,
  type RuntimeExperiment,
  removeSectionVariants,
  variantName,
} from '@/src/lib/sites/experiments'
import { parseSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'
import {
  experimentFingerprintsOf,
  experimentVariantsOf,
  toRuntimeExperiment,
  toSiteExperimentDTO,
} from '@/src/mappers/site-experiment.mapper'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteExperimentRepository } from '@/src/repositories/site-experiment.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import {
  type CreateSiteExperimentDTO,
  MAX_EXPERIMENTS_PER_SITE,
  type RecordSiteExperimentEventsDTO,
  type SiteExperimentAction,
  type UpdateSiteExperimentDTO,
} from '@/src/schemas/site-experiment.schema'
import type {
  SiteExperimentDTO,
  SiteExperimentImpactDTO,
  SiteExperimentVariantKey,
} from '@/types/site-experiment'
import { assertModuleEnabled } from './authz'
import { authorizeSite } from './site-access'
import { SitePageService } from './site-page.service'

const invalidState = (message: string) =>
  appError('SITE_EXPERIMENT_INVALID_STATE', message)

const json = (value: unknown) => JSON.parse(JSON.stringify(value))

type Pages = Array<{ id: string; document: CanvasDocument }>

/** Pages of the live version; `null` while the site is not published. */
async function publishedPages(site: Site): Promise<Result<Pages | null>> {
  if (!site.publishedVersionId) return ok(null)
  const version = await SiteRepository.findVersion(
    site.id,
    site.publishedVersionId,
  )
  if (!version.ok) return version
  const snapshot = parseSiteSnapshot(version.value.snapshot)
  return ok(snapshot.ok ? snapshot.value.pages : null)
}

async function draftPages(siteId: string): Promise<Result<Pages>> {
  const pages = await SitePageRepository.listWithDocuments(siteId)
  if (!pages.ok) return pages
  return ok(
    pages.value.map((page) => ({
      id: page.id,
      document: page.document as unknown as CanvasDocument,
    })),
  )
}

async function toDTO(
  experiment: SiteExperiment,
  published: Pages | null,
  now = new Date(),
): Promise<Result<SiteExperimentDTO>> {
  const counts = await SiteExperimentRepository.countEvents(
    experiment.id,
    experiment.run,
  )
  if (!counts.ok) return counts
  const runtime = toRuntimeExperiment(experiment)
  return ok(
    toSiteExperimentDTO(experiment, {
      counts: counts.value,
      unpublishedVariants: published
        ? missingVariants(runtime, published)
        : runtime.variants.map((variant) => variant.key),
      now,
    }),
  )
}

/** Running/paused tests on the same section or page as `experiment`. */
function conflictsWith(
  experiment: RuntimeExperiment,
  others: SiteExperiment[],
): SiteExperiment | undefined {
  return others.find((other) => {
    if (other.id === experiment.id || other.pageId !== experiment.pageId) {
      return false
    }
    if (experiment.kind === 'PAGE' || other.kind === 'PAGE') return true
    return other.controlNodeId === experiment.controlNodeId
  })
}

/** The live version has every variant of the test. */
async function checkPublishable(
  site: Site,
  experiment: RuntimeExperiment,
): Promise<Result<Pages>> {
  const pages = await publishedPages(site)
  if (!pages.ok) return pages
  const missing = pages.value ? missingVariants(experiment, pages.value) : []
  if (!pages.value || missing.length > 0) {
    return err(
      appError(
        'SITE_EXPERIMENT_NOT_PUBLISHED',
        pages.value
          ? `Publique o site com ${missing.map(variantName).join(', ')} antes de iniciar o teste`
          : 'Publique o site antes de iniciar o teste',
        { missing },
      ),
    )
  }
  return ok(pages.value)
}

/**
 * A/B tests of a site ("Testes A/B"). The variants live in the draft like
 * any content and the test runs on the live version: starting needs every
 * variant published, and a publish that changes a running test's variants
 * restarts it (`syncWithPublication`). Start, pause and stop take effect
 * right away (the runtime reads the tests under the site's cache tag).
 */
export const SiteExperimentService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteExperimentDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const [experiments, published] = await Promise.all([
      SiteExperimentRepository.listBySite(siteId),
      publishedPages(site.value),
    ])
    if (!experiments.ok) return experiments
    if (!published.ok) return published
    const out: SiteExperimentDTO[] = []
    for (const experiment of experiments.value) {
      const dto = await toDTO(experiment, published.value)
      if (!dto.ok) return dto
      out.push(dto.value)
    }
    return ok(out)
  },

  async get(
    actorId: string,
    workspaceId: string,
    siteId: string,
    experimentId: string,
  ): Promise<Result<SiteExperimentDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const experiment = await SiteExperimentRepository.findById(
      experimentId,
      siteId,
    )
    if (!experiment.ok) return experiment
    const published = await publishedPages(site.value)
    if (!published.ok) return published
    return toDTO(experiment.value, published.value)
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteExperimentDTO,
  ): Promise<Result<SiteExperimentDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const total = await SiteExperimentRepository.count(siteId)
    if (!total.ok) return total
    if (total.value >= MAX_EXPERIMENTS_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_EXPERIMENTS_PER_SITE} testes A/B`,
        ),
      )
    }

    const page = await SitePageRepository.findById(dto.pageId, siteId)
    if (!page.ok) return page
    if (dto.goal.type === 'PAGE') {
      const goalPage = await SitePageRepository.findById(
        dto.goal.pageId,
        siteId,
      )
      if (!goalPage.ok) return goalPage
    }

    const count =
      dto.kind === 'SECTION'
        ? 1 + (dto.variantNodeIds?.length ?? 0)
        : 1 + dto.variantCount
    const weights = dto.weights ?? evenWeights(count)
    const keys = EXPERIMENT_VARIANT_KEYS.slice(0, count)
    let variants: ExperimentVariant[]

    if (dto.kind === 'SECTION') {
      const nodeIds = [
        dto.controlNodeId as string,
        ...(dto.variantNodeIds as string[]),
      ]
      variants = keys.map((key, index) => ({
        key,
        name: variantName(key),
        weight: weights[index],
        nodeId: nodeIds[index],
      }))
    } else {
      // Hidden copies of the page (noindex: out of the menu and sitemap).
      variants = [
        {
          key: CONTROL_KEY,
          name: variantName(CONTROL_KEY),
          weight: weights[0],
          pageId: dto.pageId,
        },
      ]
      for (const [index, key] of keys.slice(1).entries()) {
        const copy = await SitePageService.duplicate(
          actorId,
          workspaceId,
          siteId,
          dto.pageId,
          { title: `${page.value.title} (${variantName(key)})`.slice(0, 120) },
        )
        if (!copy.ok) return copy
        const hidden = await SitePageService.update(
          actorId,
          workspaceId,
          siteId,
          copy.value.id,
          { seo: { ...copy.value.seo, noindex: true } },
        )
        if (!hidden.ok) return hidden
        variants.push({
          key,
          name: variantName(key),
          weight: weights[index + 1],
          pageId: copy.value.id,
        })
      }
    }

    const created = await SiteExperimentRepository.create({
      siteId,
      pageId: dto.pageId,
      name: dto.name,
      kind: dto.kind,
      controlNodeId:
        dto.kind === 'SECTION' ? (dto.controlNodeId ?? null) : null,
      variants: json(variants),
      goal: json(dto.goal),
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
      createdById: actorId,
    })
    if (!created.ok) return created

    auditMutation({
      entity: 'site_experiment',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, kind: dto.kind, variants: variants.length },
    })
    const published = await publishedPages(site.value)
    if (!published.ok) return published
    return toDTO(created.value, published.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    experimentId: string,
    dto: UpdateSiteExperimentDTO,
  ): Promise<Result<SiteExperimentDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteExperimentRepository.findById(
      experimentId,
      siteId,
    )
    if (!current.ok) return current
    const experiment = current.value
    if (experiment.status === 'ENDED') {
      return err(invalidState('Este teste já terminou'))
    }

    const before = toRuntimeExperiment(experiment)
    if (dto.variants) {
      const invalid = dto.variants.some((variant) =>
        experiment.kind === 'SECTION' ? !variant.nodeId : !variant.pageId,
      )
      const control = dto.variants[0]
      const sameControl =
        experiment.kind === 'SECTION'
          ? control.nodeId === experiment.controlNodeId
          : control.pageId === experiment.pageId
      if (invalid || !sameControl) {
        return err(
          appError(
            'VALIDATION_ERROR',
            'Cada variante precisa apontar para a sua seção ou página, e a A é a original',
          ),
        )
      }
    }
    if (dto.goal?.type === 'PAGE' && dto.goal.pageId === experiment.pageId) {
      return err(
        appError(
          'VALIDATION_ERROR',
          'A página da meta precisa ser outra, não a testada',
        ),
      )
    }

    const setupChanged =
      (dto.variants !== undefined &&
        JSON.stringify(dto.variants) !== JSON.stringify(before.variants)) ||
      (dto.goal !== undefined &&
        JSON.stringify(dto.goal) !== JSON.stringify(before.goal))
    const active =
      experiment.status === 'RUNNING' || experiment.status === 'PAUSED'
    if (setupChanged && active && !dto.restart) {
      return err(
        appError(
          'SITE_EXPERIMENT_RUNNING',
          'Mudar as variantes ou a meta de um teste em andamento reinicia o teste',
        ),
      )
    }

    const next = {
      ...before,
      variants: dto.variants ?? before.variants,
      goal: dto.goal ?? before.goal,
    }
    let restart: { run: number; startedAt: Date; fingerprints: object } | null =
      null
    if (setupChanged && active) {
      const pages = await checkPublishable(site.value, next)
      if (!pages.ok) return pages
      restart = {
        run: experiment.run + 1,
        startedAt: new Date(),
        fingerprints: variantFingerprints(next, pages.value),
      }
    }

    const updated = await SiteExperimentRepository.update(experimentId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.variants ? { variants: json(dto.variants) } : {}),
      ...(dto.goal ? { goal: json(dto.goal) } : {}),
      ...(dto.startsAt !== undefined
        ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
        : {}),
      ...(dto.endsAt !== undefined
        ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
        : {}),
      ...(restart ?? {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_experiment',
      action: 'update',
      actorId,
      targetId: experimentId,
      meta: {
        siteId,
        fields: Object.keys(dto).filter((key) => key !== 'restart'),
        restarted: restart !== null,
      },
    })
    const published = await publishedPages(site.value)
    if (!published.ok) return published
    return toDTO(updated.value, published.value)
  },

  /** start, pause, resume, stop or restart. */
  async transition(
    actorId: string,
    workspaceId: string,
    siteId: string,
    experimentId: string,
    action: SiteExperimentAction,
  ): Promise<Result<SiteExperimentDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteExperimentRepository.findById(
      experimentId,
      siteId,
    )
    if (!current.ok) return current
    const experiment = current.value
    const runtime = toRuntimeExperiment(experiment)
    const now = new Date()

    const allowed: Record<SiteExperimentAction, string[]> = {
      start: ['DRAFT'],
      pause: ['RUNNING'],
      resume: ['PAUSED'],
      stop: ['DRAFT', 'RUNNING', 'PAUSED'],
      restart: ['RUNNING', 'PAUSED'],
    }
    if (!allowed[action].includes(experiment.status)) {
      return err(
        invalidState(
          experiment.status === 'ENDED'
            ? 'Este teste já terminou'
            : 'Esta ação não vale para o estado atual do teste',
        ),
      )
    }

    let data: Parameters<typeof SiteExperimentRepository.update>[1]
    if (action === 'pause') {
      data = { status: 'PAUSED' }
    } else if (action === 'stop') {
      data = { status: 'ENDED', endedAt: now }
    } else {
      const pages = await checkPublishable(site.value, runtime)
      if (!pages.ok) return pages
      if (action !== 'restart') {
        const others = await SiteExperimentRepository.listActive(siteId)
        if (!others.ok) return others
        const conflict = conflictsWith(runtime, others.value)
        if (conflict) {
          return err(
            appError(
              'SITE_EXPERIMENT_CONFLICT',
              `O teste "${conflict.name}" já está rodando nesta ${experiment.kind === 'PAGE' || conflict.kind === 'PAGE' ? 'página' : 'seção'}`,
            ),
          )
        }
      }
      const fingerprints = variantFingerprints(runtime, pages.value)
      if (action === 'resume') {
        // Content changed while paused (a publish restarts only running
        // tests): start a fresh run instead of mixing results.
        const changed = changedVariants(
          experimentFingerprintsOf(experiment),
          fingerprints,
        )
        data = {
          status: 'RUNNING',
          ...(changed.length > 0
            ? { run: experiment.run + 1, startedAt: now, fingerprints }
            : {}),
        }
      } else if (action === 'start') {
        data = { status: 'RUNNING', startedAt: now, fingerprints }
      } else {
        data = {
          status: 'RUNNING',
          run: experiment.run + 1,
          startedAt: now,
          fingerprints,
        }
      }
    }

    const updated = await SiteExperimentRepository.update(experimentId, {
      ...data,
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_experiment',
      action,
      actorId,
      targetId: experimentId,
      meta: { siteId, run: updated.value.run },
    })
    logger.info('sites.experiment.transition', {
      siteId,
      experimentId,
      action,
      run: updated.value.run,
    })
    const published = await publishedPages(site.value)
    if (!published.ok) return published
    return toDTO(updated.value, published.value, now)
  },

  /**
   * "Aplicar vencedora": the winner goes into the draft (section in the
   * control's place, or the page's content), the other versions are
   * removed, and the test ends. Publishing makes it live.
   */
  async applyWinner(
    actorId: string,
    workspaceId: string,
    siteId: string,
    experimentId: string,
    variantKey: SiteExperimentVariantKey,
  ): Promise<Result<SiteExperimentDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteExperimentRepository.findById(
      experimentId,
      siteId,
    )
    if (!current.ok) return current
    const experiment = current.value
    if (experiment.winnerKey) {
      return err(invalidState('A vencedora deste teste já foi aplicada'))
    }
    const variants = experimentVariantsOf(experiment)
    const winner = variants.find((variant) => variant.key === variantKey)
    if (!winner) {
      return err(appError('VALIDATION_ERROR', 'Variante não encontrada'))
    }

    const applied = await promoteInDraft(
      actorId,
      workspaceId,
      siteId,
      experiment,
      variants,
      winner,
    )
    if (!applied.ok) return applied

    const now = new Date()
    const updated = await SiteExperimentRepository.update(experimentId, {
      status: 'ENDED',
      endedAt: experiment.endedAt ?? now,
      winnerKey: variantKey,
      updatedById: actorId,
    })
    if (!updated.ok) return updated

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_experiment',
      action: 'apply_winner',
      actorId,
      targetId: experimentId,
      meta: { siteId, variantKey },
    })
    const published = await publishedPages(site.value)
    if (!published.ok) return published
    return toDTO(updated.value, published.value, now)
  },

  /** Deletes a test; its challengers leave the draft (the original
   * stays), unless a winner was already applied. */
  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    experimentId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const current = await SiteExperimentRepository.findById(
      experimentId,
      siteId,
    )
    if (!current.ok) return current
    const experiment = current.value

    if (!experiment.winnerKey) {
      // Variants another open test still uses stay in the draft.
      const all = await SiteExperimentRepository.listBySite(siteId)
      if (!all.ok) return all
      const shared = new Set(
        all.value
          .filter((other) => other.id !== experimentId && !other.winnerKey)
          .flatMap((other) =>
            experimentVariantsOf(other).flatMap((variant) => [
              variant.nodeId,
              variant.pageId,
            ]),
          ),
      )
      const variants = experimentVariantsOf(experiment).filter(
        (variant) =>
          variant.key === CONTROL_KEY ||
          !shared.has(variant.nodeId ?? variant.pageId),
      )
      const control = variants.find((variant) => variant.key === CONTROL_KEY)
      if (control) {
        const cleaned = await promoteInDraft(
          actorId,
          workspaceId,
          siteId,
          experiment,
          variants,
          control,
        )
        if (!cleaned.ok) return cleaned
      }
    }

    const removed = await SiteExperimentRepository.delete(experimentId)
    if (!removed.ok) return removed

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_experiment',
      action: 'delete',
      actorId,
      targetId: experimentId,
      meta: { siteId },
    })
    return ok(undefined)
  },

  /** Running and paused tests whose variants differ between the draft and
   * the live version: publishing restarts them (the publish dialog warns). */
  async impact(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteExperimentImpactDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const [active, pages] = await Promise.all([
      SiteExperimentRepository.listActive(siteId),
      draftPages(siteId),
    ])
    if (!active.ok) return active
    if (!pages.ok) return pages
    const experiments = active.value.flatMap((experiment) => {
      const changed = changedVariants(
        experimentFingerprintsOf(experiment),
        variantFingerprints(toRuntimeExperiment(experiment), pages.value),
      )
      return changed.length > 0
        ? [
            {
              id: experiment.id,
              name: experiment.name,
              variants: changed as SiteExperimentVariantKey[],
            },
          ]
        : []
    })
    return ok({ experiments })
  },

  /**
   * After a publish: a running test whose variants changed starts a new
   * run, so its results only count the content visitors see now. A paused
   * one is checked when resumed. Failures are logged, never block the
   * publish.
   */
  async syncWithPublication(
    siteId: string,
    snapshot: Pick<SiteSnapshot, 'pages'>,
  ): Promise<Result<string[]>> {
    const active = await SiteExperimentRepository.listActive(siteId)
    if (!active.ok) return active
    const restarted: string[] = []
    const now = new Date()
    for (const experiment of active.value) {
      if (experiment.status !== 'RUNNING') continue
      const fingerprints = variantFingerprints(
        toRuntimeExperiment(experiment),
        snapshot.pages,
      )
      const changed = changedVariants(
        experimentFingerprintsOf(experiment),
        fingerprints,
      )
      if (changed.length === 0) continue
      const updated = await SiteExperimentRepository.update(experiment.id, {
        run: experiment.run + 1,
        startedAt: now,
        fingerprints,
      })
      if (!updated.ok) return updated
      restarted.push(experiment.id)
      logger.info('sites.experiment.restarted_by_publish', {
        siteId,
        experimentId: experiment.id,
        run: experiment.run + 1,
        variants: changed,
      })
    }
    return ok(restarted)
  },

  /** Running tests of a site by slug (public runtime, no session). */
  async runningForSlug(slug: string): Promise<Result<RuntimeExperiment[]>> {
    const experiments = await SiteExperimentRepository.listRunningBySlug(slug)
    if (!experiments.ok) return experiments
    return ok(experiments.value.map(toRuntimeExperiment))
  },

  /**
   * Exposure/conversion beacon. The variant is recomputed from the
   * visitor key (never trusted from the client); a conversion counts only
   * for a visitor exposed in the same run, once, for the variant they saw.
   */
  async recordEvents(
    slug: string,
    request: {
      ip: string
      userAgent: string
      cookie: string | null
      now?: Date
    },
    dto: RecordSiteExperimentEventsDTO,
  ): Promise<Result<{ recorded: number }>> {
    const site = await SiteRepository.findPublishedBySlug(slug)
    if (!site.ok) return site
    const enabled = await assertModuleEnabled(site.value.workspaceId, 'CRM')
    if (!enabled.ok) {
      return err(appError('SITE_NOT_FOUND', 'Site não encontrado'))
    }
    const running = await SiteExperimentRepository.listRunningBySlug(slug)
    if (!running.ok) return running

    const now = request.now ?? new Date()
    const live = running.value.filter((experiment) =>
      isExperimentLive(toRuntimeExperiment(experiment), now),
    )
    const visitorKey = resolveAbVisitorKey({
      cookie: request.cookie,
      ip: request.ip,
      userAgent: request.userAgent,
      siteId: site.value.id,
      secret: BETTER_AUTH_SECRET,
      now,
    })

    let recorded = 0
    const seen = new Set<string>()
    for (const event of dto.events) {
      const id = `${event.experimentId}:${event.kind}`
      if (seen.has(id)) continue
      seen.add(id)
      const experiment = live.find((item) => item.id === event.experimentId)
      if (!experiment) continue

      let variantKey: string | null
      if (event.kind === 'EXPOSURE') {
        variantKey = assignVariant(
          experimentVariantsOf(experiment),
          experiment.id,
          visitorKey,
        )
      } else {
        const exposure = await SiteExperimentRepository.findExposure(
          experiment.id,
          experiment.run,
          visitorKey,
        )
        if (!exposure.ok) return exposure
        variantKey = exposure.value
      }
      if (!variantKey) continue

      const written = await SiteExperimentRepository.recordEvent({
        experimentId: experiment.id,
        run: experiment.run,
        variantKey,
        kind: event.kind,
        visitorKey,
      })
      if (!written.ok) return written
      if (written.value) recorded++
    }
    return ok({ recorded })
  },
}

/** Puts `winner` in the draft and removes the other versions. */
async function promoteInDraft(
  actorId: string,
  workspaceId: string,
  siteId: string,
  experiment: SiteExperiment,
  variants: ExperimentVariant[],
  winner: ExperimentVariant,
): Promise<Result<void>> {
  if (experiment.kind === 'SECTION') {
    const page = await SitePageRepository.findById(experiment.pageId, siteId)
    if (!page.ok) {
      // The page is gone: nothing left to clean.
      return page.error.code === 'SITE_PAGE_NOT_FOUND' ? ok(undefined) : page
    }
    const doc = page.value.document as unknown as CanvasDocument
    const nodeIds = variants.flatMap((variant) =>
      variant.nodeId ? [variant.nodeId] : [],
    )
    const controlId = experiment.controlNodeId ?? nodeIds[0]
    const next =
      winner.key === CONTROL_KEY
        ? removeSectionVariants(
            doc,
            nodeIds.filter((id) => id !== controlId),
          )
        : promoteSectionVariant(doc, {
            controlId,
            variantIds: nodeIds,
            winnerId: winner.nodeId as string,
          })
    if (!next) {
      return err(
        appError(
          'VALIDATION_ERROR',
          'A variante vencedora não está mais no rascunho da página',
        ),
      )
    }
    if (next === doc) return ok(undefined)
    const saved = await SitePageService.update(
      actorId,
      workspaceId,
      siteId,
      experiment.pageId,
      { document: next },
    )
    return saved.ok ? ok(undefined) : saved
  }

  // PAGE: the winner's content goes into the tested page; the copies go.
  if (winner.key !== CONTROL_KEY && winner.pageId) {
    const source = await SitePageRepository.findById(winner.pageId, siteId)
    if (!source.ok) return source
    const saved = await SitePageService.update(
      actorId,
      workspaceId,
      siteId,
      experiment.pageId,
      { document: source.value.document as unknown as CanvasDocument },
    )
    if (!saved.ok) return saved
  }
  for (const variant of variants) {
    if (variant.key === CONTROL_KEY || !variant.pageId) continue
    const removed = await SitePageService.remove(
      actorId,
      workspaceId,
      siteId,
      variant.pageId,
    )
    if (!removed.ok && removed.error.code !== 'SITE_PAGE_NOT_FOUND') {
      return removed
    }
  }
  return ok(undefined)
}
