import { createId } from '@paralleldrive/cuid2'
import type { Prisma, Site } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { aiProviderUnavailable, validationError } from '@/src/errors'
import { type AppError, appError } from '@/src/errors/app-error'
import { findAiModel, isAiProviderConfigured } from '@/src/lib/ai'
import { aiModelPricing } from '@/src/lib/ai/models'
import {
  currentPeriodStart,
  isQuotaExceeded,
  remainingUsd,
} from '@/src/lib/ai/quota'
import type { AiUsageTokens } from '@/src/lib/ai/types'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { ROOT_ID } from '@/src/lib/canvas/types'
import type { CanvasLink } from '@/src/lib/canvas/values'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import {
  SITE_CATALOG_ID,
  SITE_CATALOG_VERSION,
  SITE_TYPES,
} from '@/src/lib/canvas-site/constants'
import { SITE_KITS } from '@/src/lib/canvas-site/presets/kits'
import { parseSiteTheme, type SiteTheme } from '@/src/lib/canvas-site/theme'
import {
  consume,
  siteInspirationUserLimiter,
  siteInspirationWorkspaceLimiter,
} from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { stripUrlForDisplay } from '@/src/lib/safe-fetch/fetch-html'
import {
  buildGlobalDocuments,
  buildPageDocument,
  buildSectionFragment,
  fixLinks,
  keepValidSections,
  replaceSampleBrand,
} from '@/src/lib/site-ai/assemble'
import { estimateSiteAi } from '@/src/lib/site-ai/estimate'
import {
  buildReferenceSources,
  type FidelityResult,
  fidelityPageDocument,
  isAnalyzable,
  pickReadySlots,
  runFidelityPipeline,
} from '@/src/lib/site-ai/fidelity/blueprint'
import { queueCapturePort } from '@/src/lib/site-ai/fidelity/capture/queue-port'
import {
  type CapturePort,
  getCapturePort,
} from '@/src/lib/site-ai/fidelity/capture-port'
import type { ReferenceCapture } from '@/src/lib/site-ai/fidelity/types'
import {
  buildCandidates,
  collectImageTargets,
  describeImageRequest,
  libraryDescriptions,
  toImageSuggestions,
} from '@/src/lib/site-ai/images'
import {
  buildPlanTheme,
  inferKit,
  normalizePlan,
  requestedKinds,
  SITE_PLAN_JSON_SCHEMA,
  type SitePageKind,
  type SitePlan,
  SitePlanOutputSchema,
} from '@/src/lib/site-ai/plan'
import {
  briefLines,
  buildImagesSystem,
  buildPageCopySystem,
  buildPlanSystem,
  buildRewriteSystem,
  buildSectionChoiceSystem,
  buildSectionCopySystem,
  checkFields,
  describeSlots,
  FIELDS_JSON_SCHEMA,
  FieldsOutputSchema,
  IMAGES_JSON_SCHEMA,
  ImagesOutputSchema,
  PAGE_COPY_JSON_SCHEMA,
  PageCopyOutputSchema,
  SECTION_CHOICE_JSON_SCHEMA,
  SectionChoiceOutputSchema,
} from '@/src/lib/site-ai/prompts'
import { structuredCall } from '@/src/lib/site-ai/run'
import {
  CONTACT_ANCHOR,
  type SectionContext,
  type SiteAiFormData,
  type SiteAiProductData,
  type SiteAiTestimonialData,
} from '@/src/lib/site-ai/sections'
import {
  applySlots,
  collectSlots,
  type TextSlot,
} from '@/src/lib/site-ai/slots'
import {
  buildInspirationBlock,
  type InspirationLinkResult,
  readInspirationLink,
} from '@/src/lib/site-inspiration/read'
import { validateSiteDocument } from '@/src/lib/sites/document'
import { siteSlugFromName } from '@/src/lib/sites/slug'
import {
  toSiteAiFormData,
  toSiteAiFormDTO,
  toSiteAiProductDTOs,
} from '@/src/mappers/site-ai.mapper'
import { AiUsageRepository } from '@/src/repositories/ai-settings.repository'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import {
  type SiteDraftGlobalInput,
  type SiteDraftPageInput,
  SiteRepository,
} from '@/src/repositories/site.repository'
import { SiteAiRepository } from '@/src/repositories/site-ai.repository'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { CreateCrmFormSchema } from '@/src/schemas/crm-form.schema'
import { DEFAULT_SITE_SETTINGS } from '@/src/schemas/site.schema'
import {
  type GenerateSiteDTO,
  type GenerateSiteSectionDTO,
  type RewriteSitePageDTO,
  SITE_AI_PAGE_LABELS,
  type SuggestSiteImagesDTO,
} from '@/src/schemas/site-ai.schema'
import type {
  SiteAiContextDTO,
  SiteAiEstimateDTO,
  SiteAiEvent,
  SiteAiImagesResultDTO,
  SiteAiLinkDTO,
  SiteAiNodeChange,
  SiteAiRewriteResultDTO,
  SiteAiSectionResultDTO,
  SiteAiStep,
} from '@/types/site-ai'
import { listUsableAiModels } from './ai-model-options'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { CrmFormService } from './crm-form.service'
import { assertFeature } from './feature-flag.service'
import { PlatformAiSettingsService } from './platform-ai-settings.service'
import {
  findFreeSiteSlug,
  MAX_SITES_PER_WORKSPACE,
  toPublicSiteDTO,
} from './site.service'
import { assertSitesPermission, authorizeSite } from './site-access'
import { SiteMediaService } from './site-media.service'

/**
 * AI site generator (S4) on the CRM AI provider and monthly quota (ADR
 * 0007, plan feature `crm.aiAssistant`, usage as `CRM_ASSISTANT`): a whole
 * site from a guided brief, streamed step by step, and three editor
 * actions — a new section, a page rewrite and image suggestions. The model
 * only writes copy into the slots of the catalog's presets (and picks
 * among known images), every answer is repaired or retried, and every
 * document passes `validateSiteDocument` before it is stored or returned.
 */

const COMPONENT = 'SiteAiService'
const PLAN_MAX_TOKENS = 2_000
const PAGE_MAX_TOKENS = 8_000
const SECTION_MAX_TOKENS = 4_000
const REWRITE_MAX_TOKENS = 8_000
const IMAGES_MAX_TOKENS = 3_000
/** Pages written at the same time during a generation. */
export const PAGE_CONCURRENCY = 3
/** Most text fields one rewrite sends to the model. */
export const MAX_REWRITE_SLOTS = 150
/** Inspiration links read at the same time. */
export const INSPIRATION_CONCURRENCY = 3
/** Wait for the first chunk of a provider answer on the fidelity path. */
export const FIDELITY_PROVIDER_TIMEOUT_MS = 300_000

const json = (value: unknown) => value as Prisma.InputJsonValue
const round = (value: number) => Math.round(value * 10_000) / 10_000

const aiFailed = (
  message = 'A IA não conseguiu concluir agora. Tente de novo em instantes.',
): AppError => appError('SITE_AI_FAILED', message)

/** Plan feature + quota, after the caller's permission check. */
async function prepareCall(
  actorId: string,
  workspaceId: string,
  modelKey?: string,
  options: { timeoutMs?: number } = {},
): Promise<Result<PreparedAiCall>> {
  const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature
  if (!modelKey) {
    return options.timeoutMs === undefined
      ? AiUsageService.prepare(workspaceId, 'CRM_ASSISTANT', actorId)
      : AiUsageService.prepare(
          workspaceId,
          'CRM_ASSISTANT',
          actorId,
          [],
          options,
        )
  }
  // The chosen model must be usable here (enabled for the workspace, with a
  // key in this environment): resolution would silently fall back to the
  // default, so an unusable choice is refused instead.
  const resolved = await AiUsageService.resolveModel(
    workspaceId,
    'CRM_ASSISTANT',
    actorId,
    [modelKey],
  )
  if (!resolved.ok) return resolved
  if (resolved.value.model?.key !== modelKey) {
    return err(
      aiProviderUnavailable(
        'O modelo de IA escolhido não está disponível neste workspace. Escolha outro em "Gerar com".',
      ),
    )
  }
  return options.timeoutMs === undefined
    ? AiUsageService.prepare(workspaceId, 'CRM_ASSISTANT', actorId, [modelKey])
    : AiUsageService.prepare(
        workspaceId,
        'CRM_ASSISTANT',
        actorId,
        [modelKey],
        options,
      )
}

/** Records every provider call and keeps the running cost. */
function usageMeter(
  call: PreparedAiCall,
  workspaceId: string,
  actorId: string,
) {
  let costUsd = 0
  return {
    onUsage: async (usage: AiUsageTokens) => {
      costUsd += AiUsageService.price(call, usage)
      await AiUsageService.record(call, {
        workspaceId,
        userId: actorId,
        usage,
        scope: { module: 'CRM' },
      })
    },
    cost: () => round(costUsd),
  }
}

function fieldValues(fields: Array<{ id: string; text: string }>) {
  return new Map(fields.map((item) => [item.id, item.text]))
}

/** Writes the model's fields into a tree's nodes (in place). */
function fillSlots(
  nodes: Record<string, CanvasNode>,
  slots: TextSlot[],
  fields: Array<{ id: string; text: string }>,
) {
  const applied = applySlots(nodes, slots, fieldValues(fields))
  Object.assign(nodes, applied.nodes)
  return applied
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

/** Simple async channel: the generation pushes events from concurrent
 * page workers, the stream drains them in order of arrival. */
function channel<T>() {
  const items: T[] = []
  let wake: (() => void) | null = null
  let closed = false
  const notify = () => {
    wake?.()
    wake = null
  }
  return {
    push(item: T) {
      items.push(item)
      notify()
    },
    close() {
      closed = true
      notify()
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        while (items.length > 0) yield items.shift() as T
        if (closed) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
  }
}

/** Runs `tasks` with at most `limit` in flight; rejects on the first
 * failure (the others still settle). */
async function pool<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  )
  return results
}

class GenerationError extends Error {
  constructor(readonly error: AppError) {
    super(error.message)
  }
}

const CONTACT_FORM_FIELDS = [
  {
    key: 'nome',
    label: 'Nome',
    type: 'text',
    required: true,
    mapping: { target: 'lead', attribute: 'name' },
  },
  {
    key: 'email',
    label: 'E-mail',
    type: 'email',
    required: true,
    mapping: { target: 'lead', attribute: 'email' },
  },
  {
    key: 'telefone',
    label: 'Telefone',
    type: 'phone',
    required: false,
    mapping: { target: 'lead', attribute: 'phone' },
  },
  {
    key: 'empresa',
    label: 'Empresa',
    type: 'text',
    required: false,
    mapping: { target: 'lead', attribute: 'company' },
  },
]

/** "Contato pelo site" CRM form, created and published for the site. */
async function createContactForm(
  actorId: string,
  workspaceId: string,
): Promise<SiteAiFormData | null> {
  const created = await CrmFormService.create(
    actorId,
    workspaceId,
    CreateCrmFormSchema.parse({
      name: 'Contato pelo site',
      action: 'LEAD',
      fields: CONTACT_FORM_FIELDS,
      successMessage: 'Recebemos seu contato! Em breve falamos com você.',
    }),
  )
  if (!created.ok) return null
  const published = await CrmFormService.setPublished(
    actorId,
    workspaceId,
    created.value.id,
    true,
  )
  return published.ok ? toSiteAiFormData(published.value) : null
}

/** Points every unconfigured `site.form` of a document at `form`. */
function attachForm(doc: CanvasDocument, form: SiteAiFormData): void {
  for (const node of Object.values(doc.nodes)) {
    if (node.type === SITE_TYPES.form && !node.props.formToken) {
      node.props = { ...node.props, ...form }
    }
  }
}

interface GenerationData {
  products: SiteAiProductData[]
  testimonials: SiteAiTestimonialData[]
  form: SiteAiFormData | null
}

/** Brief data from the workspace, checked before the stream starts. */
async function loadGenerationData(
  actorId: string,
  workspaceId: string,
  dto: GenerateSiteDTO,
): Promise<Result<GenerationData>> {
  const products = await SiteAiRepository.listProducts(
    workspaceId,
    dto.productIds,
  )
  if (!products.ok) return products

  let form: SiteAiFormData | null = null
  if (dto.contactFormId) {
    const found = await CrmFormService.getById(
      actorId,
      workspaceId,
      dto.contactFormId,
    )
    if (!found.ok) return found
    if (found.value.status !== 'PUBLISHED') {
      return err(
        validationError(
          'O formulário escolhido não está publicado — publique-o no CRM ou escolha outro',
        ),
      )
    }
    form = toSiteAiFormData(found.value)
  }
  return ok({
    products: toSiteAiProductDTOs(products.value).map(
      ({ name, description, price }) => ({ name, description, price }),
    ),
    testimonials: [],
    form,
  })
}

interface PageResult {
  kind: SitePageKind
  document: CanvasDocument
  seo: { title?: string; description?: string }
  warnings: string[]
}

/** Copy of one page: build from the plan, fill the slots, repair links,
 * keep only valid sections. Throws `GenerationError` to abort. */
async function writePage(input: {
  call: PreparedAiCall
  meter: ReturnType<typeof usageMeter>
  plan: SitePlan
  page: SitePlan['pages'][number]
  ctx: SectionContext
  brief: string[]
  /** Quoted inspiration briefs (empty = no references). */
  inspiration: string[]
  testimonials: SiteAiTestimonialData[]
  workspaceId: string
  /** Reference-faithful page: sections already built (drawn from the
   * references); only the ready ones still need copy. */
  prebuilt?: {
    page: ReturnType<typeof fidelityPageDocument>
    seo: { title: string; description: string }
  }
}): Promise<PageResult> {
  const { page, ctx, prebuilt } = input
  const warnings: string[] = []
  const doc = prebuilt?.page.doc ?? buildPageDocument(page.sections, ctx)
  const slots = prebuilt
    ? pickReadySlots(prebuilt.page, collectSlots(doc))
    : collectSlots(doc)
  // A fidelity page whose sections were all drawn has no copy left to write.
  const answer =
    prebuilt && slots.length === 0
      ? null
      : await structuredCall({
          provider: input.call.provider,
          model: input.call.model.model,
          system: buildPageCopySystem({
            brief: input.brief,
            pageTitle: page.title,
            testimonials: input.testimonials,
            withInspiration: input.inspiration.length > 0,
          }),
          message: [
            `Página: ${page.title}`,
            `Botão principal do site: ${input.plan.ctaLabel}`,
            ...(input.inspiration.length > 0 ? ['', ...input.inspiration] : []),
            '',
            'Campos:',
            describeSlots(slots),
          ].join('\n'),
          schemaName: 'site_page_copy',
          jsonSchema: PAGE_COPY_JSON_SCHEMA,
          schema: PageCopyOutputSchema,
          maxTokens: PAGE_MAX_TOKENS,
          validate: (value) => checkFields(slots, value.fields),
          onUsage: input.meter.onUsage,
        })
  if (answer && !answer.ok && answer.reason === 'provider') {
    logger.error('site_ai.provider_failed', {
      component: COMPONENT,
      workspaceId: input.workspaceId,
      step: `page:${page.kind}`,
      model: input.call.model.key,
      message:
        answer.cause instanceof Error
          ? answer.cause.message
          : String(answer.cause),
    })
    // A failure on the copy of a few ready sections must not throw away
    // the sections drawn from the references.
    if (!prebuilt) throw new GenerationError(aiFailed())
  }
  const copy = answer
    ? answer.ok
      ? answer.value
      : (answer.partial ?? null)
    : null
  const seo: PageResult['seo'] = {}
  if (prebuilt) {
    if (prebuilt.seo.title) seo.title = prebuilt.seo.title
    if (prebuilt.seo.description) seo.description = prebuilt.seo.description
  }
  if (copy) {
    const applied = fillSlots(doc.nodes, slots, copy.fields)
    if (applied.skipped.length > 0) {
      warnings.push(
        `Alguns textos da página ${page.title} ficaram com o texto do modelo — revise no editor.`,
      )
    }
    if (!prebuilt) {
      const title = clip(copy.seoTitle, 70)
      const description = clip(copy.seoDescription, 160)
      if (title) seo.title = title
      if (description) seo.description = description
    }
  } else if (answer) {
    warnings.push(
      `A IA não escreveu os textos da página ${page.title}; ela ficou com o texto do modelo.`,
    )
  }
  replaceSampleBrand(doc.nodes, ctx.companyName)
  fixLinks(doc.nodes, ctx.contactLink)
  const checked = keepValidSections(doc)
  if (!checked.ok) {
    logger.error('site_ai.invalid_page', {
      component: COMPONENT,
      workspaceId: input.workspaceId,
      page: page.kind,
      issues: checked.error.slice(0, 3),
    })
    throw new GenerationError(
      appError(
        'SITE_DOCUMENT_INVALID',
        `Não foi possível montar a página ${page.title}`,
      ),
    )
  }
  for (const name of checked.value.dropped) {
    warnings.push(`A seção "${name}" da página ${page.title} foi descartada.`)
  }
  return { kind: page.kind, document: checked.value.doc, seo, warnings }
}

function contactLinkFor(
  kind: SitePageKind,
  pageIds: Record<string, string>,
): CanvasLink {
  if (pageIds.contact) return { type: 'page', value: pageIds.contact }
  return kind === 'home'
    ? { type: 'anchor', value: CONTACT_ANCHOR }
    : { type: 'page', value: pageIds.home }
}

const CAPTURE_TIMEOUT_MS = 120_000

/** Capture of one link through the registered port; `null` when there is
 * no port, it fails or it takes too long (the text summary still works). */
async function captureLink(
  port: CapturePort | null,
  url: string,
): Promise<ReferenceCapture | null> {
  if (!port) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      port.capture(url),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)
      }),
    ])
    return result?.ok ? result.value : null
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function defaultCtaLabel(goal: GenerateSiteDTO['goal']): string {
  if (goal === 'sales') return 'Quero comprar'
  return goal === 'event' ? 'Garantir minha vaga' : 'Fale com a gente'
}

/** The plan the rest of the generation reads, from a fidelity result. */
function fidelityToSitePlan(
  result: Extract<FidelityResult, { ok: true }>,
): SitePlan {
  const { theme } = result
  return {
    siteName: result.plan.siteName,
    tagline: result.plan.tagline,
    ctaLabel: result.plan.ctaLabel,
    kit: result.kit,
    colors: {
      primary: theme.colors.primary,
      secondary: theme.colors.secondary,
      accent: theme.colors.accent,
      dark: theme.colors.dark,
    },
    fonts: { ...theme.fonts },
    pages: result.plan.pages.map((page) => ({
      kind: page.kind,
      title: page.title,
      slug: page.slug,
      sections: page.sections.map((section) => section.equivalent),
    })),
  }
}

async function* runGeneration(input: {
  actorId: string
  workspaceId: string
  dto: GenerateSiteDTO
  call: PreparedAiCall
  data: GenerationData
  slug: string
  /** US$ left of the workspace's monthly AI quota when the generation
   * started (`null` = unknown); drawing stops when the run has spent it. */
  quotaRemainingUsd: number | null
}): AsyncGenerator<SiteAiEvent> {
  const { actorId, workspaceId, dto, call, data } = input
  const hasLinks = dto.inspirationLinks.length > 0
  // Links or pictures of inspiration: the layout follows them.
  const useFidelity = hasLinks || dto.inspirationImages.length > 0
  const meter = usageMeter(call, workspaceId, actorId)
  const kinds = requestedKinds(dto)
  const steps: SiteAiStep[] = [
    ...(hasLinks
      ? [
          {
            id: 'inspiration',
            label: 'Lendo as referências…',
            status: 'pending',
          } satisfies SiteAiStep,
        ]
      : []),
    ...(useFidelity
      ? [
          {
            id: 'analysis',
            label: 'Analisando as referências…',
            status: 'pending',
          } satisfies SiteAiStep,
        ]
      : []),
    { id: 'theme', label: 'Criando tema…', status: 'pending' },
    ...kinds.map(
      (kind): SiteAiStep => ({
        id: `page:${kind}`,
        label: `Montando a página ${SITE_AI_PAGE_LABELS[kind]}…`,
        status: 'pending',
      }),
    ),
    { id: 'globals', label: 'Montando cabeçalho e rodapé…', status: 'pending' },
    { id: 'save', label: 'Salvando o site…', status: 'pending' },
  ]
  yield { type: 'steps', steps }
  const warnings: string[] = []
  const brief = briefLines(dto, {
    products: data.products,
    testimonials: data.testimonials,
    eventDate: dto.eventDate ?? null,
  })
  // 0. Inspiration links, read here (never in the browser). A link that
  // cannot be read is reported and skipped; the generation goes on.
  const links: InspirationLinkResult[] = []
  const captures: Array<ReferenceCapture | null> = dto.inspirationLinks.map(
    () => null,
  )
  const capturePort = useFidelity
    ? (getCapturePort() ?? queueCapturePort(workspaceId))
    : null
  const linkStates: SiteAiLinkDTO[] = dto.inspirationLinks.map((url) => ({
    url: stripUrlForDisplay(url),
    status: 'reading',
    message: null,
  }))
  if (hasLinks) {
    yield {
      type: 'step',
      id: 'inspiration',
      label: 'Lendo as referências…',
      status: 'running',
    }
    const linkEvents = channel<SiteAiEvent>()
    for (const [index, link] of linkStates.entries()) {
      linkEvents.push({ type: 'link', index, link })
    }
    const reading = pool(
      dto.inspirationLinks.map((url, index) => async () => {
        const [result, captured] = await Promise.all([
          readInspirationLink(url),
          captureLink(capturePort, url),
        ])
        links[index] = result
        captures[index] = captured
        // A page we could capture counts as read even when the text
        // summary failed: the capture is what the layout follows.
        linkStates[index] =
          captured && result.status === 'failed'
            ? { url: result.url, status: 'read', message: null }
            : {
                url: result.url,
                status: result.status,
                message: result.message,
              }
        linkEvents.push({ type: 'link', index, link: linkStates[index] })
      }),
      INSPIRATION_CONCURRENCY,
    ).finally(() => linkEvents.close())
    yield* linkEvents.drain()
    await reading
    const readCount = linkStates.filter((link) => link.status === 'read').length
    for (const link of linkStates) {
      if (link.status === 'failed') {
        warnings.push(
          `Não foi possível ler a referência ${link.url}: ${link.message ?? 'erro desconhecido'}`,
        )
      }
    }
    yield {
      type: 'step',
      id: 'inspiration',
      label:
        readCount === linkStates.length
          ? 'Referências lidas'
          : `${readCount} de ${linkStates.length} referências lidas`,
      status: readCount > 0 ? 'done' : 'failed',
    }
  }
  const inspiration = buildInspirationBlock(links, dto.inspirationFocus)
  const withInspiration = inspiration.length > 0

  const availability = {
    products: data.products.length > 0,
    testimonials: data.testimonials.length > 0,
    event: Boolean(dto.eventDate),
  }

  // 0b. Reference-faithful path: visual analysis of every reference, the
  // page plan, the theme and every section drawn from the references.
  // When it cannot run (nothing analyzable, every analysis failed) the
  // classic path below takes over with the text summary and the pictures.
  const pageIds: Record<string, string> = {}
  const ensurePageIds = (pagesOfPlan: Array<{ kind: SitePageKind }>) => {
    for (const page of pagesOfPlan) pageIds[page.kind] ??= createId()
  }
  const makeBaseCtx = (kit: SitePlan['kit'], ctaLabel: string) => ({
    kit: SITE_KITS[kit],
    companyName: dto.name,
    logoUrl: dto.logoUrl ?? null,
    ctaLabel,
    products: data.products,
    testimonials: data.testimonials,
    form: data.form,
    eventDate: dto.eventDate ?? null,
  })
  let fidelity: Extract<FidelityResult, { ok: true }> | null = null
  if (useFidelity) {
    const sources = buildReferenceSources({
      links: dto.inspirationLinks.map((_, index) => {
        const result = links[index]
        const summary = result
          ? buildInspirationBlock([result], '').join('\n')
          : ''
        return {
          url: linkStates[index].url,
          capture: captures[index] ?? null,
          summary: summary || null,
        }
      }),
      images: dto.inspirationImages,
    }).filter(isAnalyzable)
    if (sources.length === 0) {
      yield {
        type: 'step',
        id: 'analysis',
        label: 'Nenhuma referência pôde ser analisada',
        status: 'failed',
      }
    } else {
      const progress = channel<SiteAiEvent>()
      const drawing = runFidelityPipeline({
        llm: {
          provider: call.provider,
          model: call.model.model,
          onUsage: meter.onUsage,
        },
        brief,
        focus: dto.inspirationFocus,
        kinds,
        name: dto.name,
        defaultCtaLabel: defaultCtaLabel(dto.goal),
        primaryColor: dto.primaryColor ?? null,
        availability,
        sources,
        sectionContext: (page, fidelityPlan, kit) => {
          ensurePageIds(fidelityPlan.pages)
          return {
            ...makeBaseCtx(kit, fidelityPlan.ctaLabel),
            pageTitle: page.title,
            contactLink: contactLinkFor(page.kind, pageIds),
          }
        },
        onProgress: (step) => progress.push({ type: 'step', ...step }),
        overBudget: () =>
          input.quotaRemainingUsd !== null &&
          meter.cost() >= input.quotaRemainingUsd,
      }).finally(() => progress.close())
      drawing.catch(() => undefined)
      yield* progress.drain()
      try {
        const outcome = await drawing
        warnings.push(...outcome.warnings)
        if (outcome.ok) fidelity = outcome
        else {
          warnings.push(
            'Não foi possível seguir o layout das referências; o site usa as seções padrão, inspiradas nelas.',
          )
        }
      } catch (cause) {
        logger.error('site_ai.fidelity_failed', {
          component: COMPONENT,
          workspaceId,
          model: call.model.key,
          message: cause instanceof Error ? cause.message : String(cause),
        })
        yield {
          type: 'step',
          id: 'analysis',
          label: 'Análise das referências falhou',
          status: 'failed',
        }
        warnings.push(
          'Não foi possível seguir o layout das referências; o site usa as seções padrão, inspiradas nelas.',
        )
      }
    }
  }

  // 1. Theme and page tree.
  let plan: SitePlan
  let theme: SiteTheme
  if (fidelity) {
    plan = fidelityToSitePlan(fidelity)
    theme = fidelity.theme
  } else {
    yield {
      type: 'step',
      id: 'theme',
      label: 'Criando tema…',
      status: 'running',
    }
    const planned = await structuredCall({
      provider: call.provider,
      model: call.model.model,
      system: buildPlanSystem(
        kinds,
        withInspiration || dto.inspirationImages.length > 0,
        dto.inspirationImages.length > 0,
      ),
      message: [
        'Briefing:',
        ...brief,
        ...inspiration,
        ...(dto.inspirationImages.length > 0
          ? [`Imagens de referência anexadas: ${dto.inspirationImages.length}.`]
          : []),
      ].join('\n'),
      images: dto.inspirationImages,
      schemaName: 'site_plan',
      jsonSchema: SITE_PLAN_JSON_SCHEMA,
      schema: SitePlanOutputSchema,
      maxTokens: PLAN_MAX_TOKENS,
      onUsage: meter.onUsage,
    })
    if (!planned.ok && planned.reason === 'provider') {
      logger.error('site_ai.provider_failed', {
        component: COMPONENT,
        workspaceId,
        step: 'theme',
        model: call.model.key,
        message:
          planned.cause instanceof Error
            ? planned.cause.message
            : String(planned.cause),
      })
      yield {
        type: 'step',
        id: 'theme',
        label: 'Criando tema…',
        status: 'failed',
      }
      const error = aiFailed()
      yield { type: 'error', code: error.code, message: error.message }
      return
    }
    if (!planned.ok) {
      warnings.push(
        'A IA não sugeriu um tema; usamos o estilo e as seções padrão.',
      )
    }
    plan = normalizePlan(planned.ok ? planned.value : null, dto, availability)
    theme = buildPlanTheme(plan)
    yield { type: 'step', id: 'theme', label: 'Tema criado', status: 'done' }
  }

  // 2. Pages, a few at a time.
  ensurePageIds(plan.pages)
  const baseCtx = makeBaseCtx(plan.kit, plan.ctaLabel)
  let pages: PageResult[]
  if (fidelity) {
    const drawn = fidelity
    try {
      pages = await pool(
        drawn.pages.map((result, index) => async () => {
          const page = plan.pages[index]
          return writePage({
            call,
            meter,
            plan,
            page,
            ctx: {
              ...baseCtx,
              pageTitle: page.title,
              contactLink: contactLinkFor(page.kind, pageIds),
            },
            brief,
            inspiration: [],
            testimonials: data.testimonials,
            workspaceId,
            prebuilt: {
              page: fidelityPageDocument(result),
              seo: drawn.plan.pages[index].seo,
            },
          })
        }),
        PAGE_CONCURRENCY,
      )
    } catch (cause) {
      const error = cause instanceof GenerationError ? cause.error : aiFailed()
      yield { type: 'error', code: error.code, message: error.message }
      return
    }
  } else {
    const events = channel<SiteAiEvent>()
    const pagesDone = pool(
      plan.pages.map((page) => async () => {
        const id = `page:${page.kind}`
        events.push({
          type: 'step',
          id,
          label: `Montando a página ${page.title}…`,
          status: 'running',
        })
        try {
          const result = await writePage({
            call,
            meter,
            plan,
            page,
            ctx: {
              ...baseCtx,
              pageTitle: page.title,
              contactLink: contactLinkFor(page.kind, pageIds),
            },
            brief,
            inspiration,
            testimonials: data.testimonials,
            workspaceId,
          })
          events.push({
            type: 'step',
            id,
            label: `Página ${page.title} pronta`,
            status: 'done',
          })
          return result
        } catch (cause) {
          events.push({
            type: 'step',
            id,
            label: `Página ${page.title} falhou`,
            status: 'failed',
          })
          throw cause
        }
      }),
      PAGE_CONCURRENCY,
    ).finally(() => events.close())
    // The rejection is handled below, after the queued events are sent.
    pagesDone.catch(() => undefined)
    yield* events.drain()
    try {
      pages = await pagesDone
    } catch (cause) {
      const error = cause instanceof GenerationError ? cause.error : aiFailed()
      yield { type: 'error', code: error.code, message: error.message }
      return
    }
  }
  for (const page of pages) warnings.push(...page.warnings)
  // Forms drawn from the references are bare: point them at the CRM form.
  if (fidelity && data.form) {
    for (const page of pages) attachForm(page.document, data.form)
  }

  // 3. Header and footer.
  yield {
    type: 'step',
    id: 'globals',
    label: 'Montando cabeçalho e rodapé…',
    status: 'running',
  }
  const globalCtx: SectionContext = {
    ...baseCtx,
    pageTitle: '',
    contactLink: { type: 'page', value: pageIds.contact ?? pageIds.home },
  }
  const built = buildGlobalDocuments(globalCtx, plan.tagline)
  const globals: Array<{ kind: 'HEADER' | 'FOOTER'; doc: CanvasDocument }> = []
  for (const [kind, doc] of [
    ['HEADER', built.header],
    ['FOOTER', built.footer],
  ] as const) {
    const checked = validateSiteDocument(doc)
    if (checked.ok) globals.push({ kind, doc: checked.value })
    else
      warnings.push(
        `Não foi possível montar o ${kind === 'HEADER' ? 'cabeçalho' : 'rodapé'}.`,
      )
  }
  yield {
    type: 'step',
    id: 'globals',
    label: 'Cabeçalho e rodapé prontos',
    status: 'done',
  }

  // 4. Contact form and the site rows.
  yield {
    type: 'step',
    id: 'save',
    label: 'Salvando o site…',
    status: 'running',
  }
  const documents = pages.map((page) => page.document)
  if (dto.createContactForm) {
    const form = await createContactForm(actorId, workspaceId)
    if (form) {
      for (const doc of documents) attachForm(doc, form)
    } else {
      warnings.push(
        'Não foi possível criar o formulário de contato — escolha um formulário no editor.',
      )
    }
  } else if (!data.form) {
    warnings.push(
      'O site ainda não tem formulário do CRM — escolha um na seção de contato.',
    )
  }

  const draftPages: SiteDraftPageInput[] = plan.pages.map((page, index) => ({
    id: pageIds[page.kind],
    parentId: null,
    title: page.title,
    slug: page.slug,
    path: page.slug,
    position: index,
    isHome: page.kind === 'home',
    seo: json(pages[index].seo),
    document: json(documents[index]),
  }))
  const draftGlobals: SiteDraftGlobalInput[] = globals.map((global) => ({
    kind: global.kind,
    name: global.kind === 'HEADER' ? 'Cabeçalho' : 'Rodapé',
    document: json(global.doc),
  }))
  const created = await SiteRepository.createWithPages({
    site: {
      workspaceId,
      createdById: actorId,
      name: dto.name,
      slug: input.slug,
      theme: json(theme),
      settings: json({
        ...DEFAULT_SITE_SETTINGS,
        seo: {
          ...DEFAULT_SITE_SETTINGS.seo,
          titleTemplate: `%s | ${clip(plan.siteName, 100)}`,
          description: clip(plan.tagline, 320),
          organizationName: clip(dto.name, 120),
        },
        aiGeneration: {
          modelKey: call.model.key,
          inspirationLinks: dto.inspirationLinks.length,
          inspirationRead: linkStates.filter((link) => link.status === 'read')
            .length,
        },
      }),
    },
    pages: draftPages,
    globals: draftGlobals,
  })
  if (!created.ok) {
    auditMutation({
      entity: 'site',
      action: 'create',
      actorId,
      outcome: 'failure',
      reason: created.error.code,
      meta: {
        ai: true,
        modelKey: call.model.key,
        inspirationLinks: dto.inspirationLinks.length,
      },
    })
    yield {
      type: 'step',
      id: 'save',
      label: 'Salvando o site…',
      status: 'failed',
    }
    yield {
      type: 'error',
      code: created.error.code,
      message: created.error.message,
    }
    return
  }
  const site: Site = created.value
  // Counts only (never the references' content).
  const fidelityStats = fidelity
    ? {
        references: fidelity.specs.length,
        sectionsDrawn: fidelity.pages.reduce(
          (sum, page) =>
            sum +
            page.origins.filter((origin) => origin === 'blueprint').length,
          0,
        ),
        sectionsReady: fidelity.pages.reduce(
          (sum, page) =>
            sum + page.origins.filter((origin) => origin === 'ready').length,
          0,
        ),
      }
    : null
  auditMutation({
    entity: 'site',
    action: 'create',
    actorId,
    targetId: site.id,
    meta: {
      workspaceId,
      slug: site.slug,
      ai: true,
      pages: draftPages.length,
      kit: plan.kit,
      modelKey: call.model.key,
      // Counts only: neither the URLs' query strings nor any page content
      // is stored or logged (ADR 0071).
      inspirationLinks: dto.inspirationLinks.length,
      inspirationRead: linkStates.filter((link) => link.status === 'read')
        .length,
      fidelity: fidelityStats,
    },
  })
  logger.info('site_ai.generated', {
    component: COMPONENT,
    workspaceId,
    siteId: site.id,
    pages: draftPages.length,
    kit: plan.kit,
    warnings: warnings.length,
    costUsd: meter.cost(),
    model: call.model.key,
    inspirationLinks: dto.inspirationLinks.length,
    fidelity: fidelityStats,
  })
  yield { type: 'step', id: 'save', label: 'Site salvo', status: 'done' }
  yield {
    type: 'done',
    site: toPublicSiteDTO(site),
    costUsd: meter.cost(),
    warnings,
    links: linkStates,
    modelKey: call.model.key,
  }
}

/** A validation-wrapped page document holding one fragment. */
function fragmentDocument(fragment: {
  rootId: string
  nodes: Record<string, CanvasNode>
}): CanvasDocument {
  return {
    catalog: SITE_CATALOG_ID,
    version: SITE_CATALOG_VERSION,
    rootId: ROOT_ID,
    nodes: {
      ...fragment.nodes,
      [ROOT_ID]: {
        id: ROOT_ID,
        type: SITE_TYPES.page,
        props: siteCatalog.components[SITE_TYPES.page].defaultProps(),
        children: [fragment.rootId],
      },
    },
  }
}

/** Editor input document, checked by the catalog. */
function checkInputDocument(input: unknown): Result<CanvasDocument> {
  const checked = validateSiteDocument(input)
  if (checked.ok) return ok(checked.value)
  return err(
    appError(
      'SITE_DOCUMENT_INVALID',
      'A página tem problemas; salve as correções e tente de novo',
      checked.error.slice(0, 5),
    ),
  )
}

export const SiteAiService = {
  /** Prefill of the guided form, quota and cost estimate. */
  async context(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SiteAiContextDTO>> {
    const membership = await assertSitesPermission(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership

    const [brand, identity, products, forms, formCreate] = await Promise.all([
      CrmEmailBuilderRepository.findBrand(workspaceId),
      CrmEmailBuilderRepository.findWorkspaceIdentity(workspaceId),
      SiteAiRepository.listProducts(workspaceId),
      CrmFormService.list(actorId, workspaceId),
      assertModuleMember(actorId, workspaceId, 'CRM', {
        resource: 'forms',
        action: 'CREATE',
      }),
    ])
    if (!brand.ok) return brand
    if (!identity.ok) return identity
    if (!products.ok) return products

    const [feature, resolved, usage, margin] = await Promise.all([
      assertFeature(workspaceId, 'crm.aiAssistant'),
      AiUsageService.resolveModel(workspaceId, 'CRM_ASSISTANT', actorId),
      AiUsageRepository.sumSince(workspaceId, currentPeriodStart()),
      PlatformAiSettingsService.getCostMargin(),
    ])
    if (!resolved.ok) return resolved
    if (!usage.ok) return usage

    const model = resolved.value.model
    const models = feature.ok
      ? await listUsableAiModels(resolved.value.settings)
      : []
    const estimates: Record<string, SiteAiEstimateDTO> = {}
    for (const item of models) {
      const definition = findAiModel(item.key)
      if (definition) {
        estimates[item.key] = {
          ...estimateSiteAi(aiModelPricing(definition), margin),
          model: definition.label,
        }
      }
    }
    const quotaUsd = resolved.value.settings.monthlyQuotaUsd
    const usedUsd = usage.value.costUsd
    const usable = model !== null && isAiProviderConfigured(model.provider)
    const saved = brand.value
    return ok({
      available: feature.ok && usable,
      unavailableReason: !feature.ok
        ? 'A IA do CRM não está incluída no plano deste workspace.'
        : usable
          ? null
          : 'Nenhum modelo de IA está disponível. Peça a um administrador para configurar em Ajustes > Steel IA.',
      brand: {
        companyName: saved?.companyName?.trim() || identity.value.name,
        logoUrl: saved?.logoUrl || identity.value.logoUrl || '',
        primaryColor: saved?.primaryColor ?? '',
        website: saved?.website ?? '',
      },
      products: toSiteAiProductDTOs(products.value),
      forms: forms.ok
        ? forms.value
            .filter((form) => form.status === 'PUBLISHED')
            .map(toSiteAiFormDTO)
        : [],
      canCreateForm: formCreate.ok,
      quota: {
        usedUsd: Math.round(usedUsd * 100) / 100,
        quotaUsd,
        remainingUsd: remainingUsd(usedUsd, quotaUsd),
        exceeded: isQuotaExceeded(usedUsd, quotaUsd),
      },
      models,
      estimates,
      defaultModelKey:
        model && models.some((item) => item.key === model.key)
          ? model.key
          : (models[0]?.key ?? null),
      estimate: model
        ? {
            ...estimateSiteAi(aiModelPricing(model), margin),
            model: model.label,
          }
        : null,
    })
  },

  /**
   * "Gerar com IA": checks everything that can fail up front (permission,
   * plan, quota, site cap, the chosen form), then returns the stream of
   * the generation. Nothing is stored until every page is ready.
   */
  async generateSite(
    actorId: string,
    workspaceId: string,
    dto: GenerateSiteDTO,
  ): Promise<Result<AsyncIterable<SiteAiEvent>>> {
    const membership = await assertSitesPermission(
      actorId,
      workspaceId,
      'CREATE',
    )
    if (!membership.ok) return membership

    const count = await SiteRepository.countByWorkspace(workspaceId)
    if (!count.ok) return count
    if (count.value >= MAX_SITES_PER_WORKSPACE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Este workspace já tem ${MAX_SITES_PER_WORKSPACE} sites`,
        ),
      )
    }

    // References make the generation long (vision calls, one per section):
    // the provider gets a generous wait for the first answer chunk.
    const withReferences =
      dto.inspirationLinks.length > 0 || dto.inspirationImages.length > 0
    const call = await prepareCall(
      actorId,
      workspaceId,
      dto.modelKey,
      withReferences ? { timeoutMs: FIDELITY_PROVIDER_TIMEOUT_MS } : {},
    )
    if (!call.ok) return call

    // Quota left when the generation starts: drawing stops once the run
    // has spent it (the rest of the sections use the ready ones).
    let quotaRemainingUsd: number | null = null
    if (withReferences && call.value.monthlyQuotaUsd !== undefined) {
      const used = await AiUsageRepository.sumSince(
        workspaceId,
        currentPeriodStart(),
      )
      if (used.ok) {
        quotaRemainingUsd = Math.max(
          0,
          call.value.monthlyQuotaUsd - used.value.costUsd,
        )
      }
    }

    // Reading links is an outbound request per link: budget per user and
    // per workspace, spent before anything is fetched.
    if (dto.inspirationLinks.length > 0) {
      const points = dto.inspirationLinks.length
      const byUser = await consume(
        siteInspirationUserLimiter,
        `user:${actorId}`,
        points,
      )
      if (!byUser.ok) return byUser
      const byWorkspace = await consume(
        siteInspirationWorkspaceLimiter,
        `workspace:${workspaceId}`,
        points,
      )
      if (!byWorkspace.ok) return byWorkspace
    }

    const data = await loadGenerationData(actorId, workspaceId, dto)
    if (!data.ok) return data

    const slug = await findFreeSiteSlug(siteSlugFromName(dto.name))
    if (!slug.ok) return slug

    logger.info('site_ai.generation_started', {
      component: COMPONENT,
      workspaceId,
      pages: dto.pages.length + 1,
      goal: dto.goal,
      style: dto.style,
      products: data.value.products.length,
      model: call.value.model.key,
      inspirationLinks: dto.inspirationLinks.length,
    })
    return ok(
      runGeneration({
        actorId,
        workspaceId,
        dto,
        call: call.value,
        data: data.value,
        slug: slug.value,
        quotaRemainingUsd,
      }),
    )
  },

  /** "Gerar seção com IA": picks a ready section for the request and
   * writes its copy. The fragment is validated; the editor inserts it. */
  async generateSection(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: GenerateSiteSectionDTO,
  ): Promise<Result<SiteAiSectionResultDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const call = await prepareCall(actorId, workspaceId)
    if (!call.ok) return call
    const pages = await SitePageRepository.listBySite(siteId)
    if (!pages.ok) return pages

    const meter = usageMeter(call.value, workspaceId, actorId)
    const context = {
      siteName: site.value.name,
      pageTitle: dto.pageTitle,
      headings: dto.headings,
    }
    const choice = await structuredCall({
      provider: call.value.provider,
      model: call.value.model.model,
      system: buildSectionChoiceSystem(context),
      message: dto.prompt,
      schemaName: 'site_section_choice',
      jsonSchema: SECTION_CHOICE_JSON_SCHEMA,
      schema: SectionChoiceOutputSchema,
      maxTokens: 400,
      onUsage: meter.onUsage,
    })
    if (!choice.ok) {
      logger.warn('site_ai.section_choice_failed', {
        component: COMPONENT,
        workspaceId,
        reason: choice.reason,
        problems: choice.problems.slice(0, 3),
      })
      return err(aiFailed())
    }

    const theme = parseSiteTheme(site.value.theme)
    const kit = SITE_KITS[dto.style === 'auto' ? inferKit(theme) : dto.style]
    const contactPage = pages.value.find((page) => page.slug === 'contato')
    const contactLink: CanvasLink = contactPage
      ? { type: 'page', value: contactPage.id }
      : {
          type: 'page',
          value: site.value.homePageId ?? pages.value[0]?.id ?? '',
        }
    const fragment = buildSectionFragment(choice.value.section, {
      kit,
      companyName: site.value.name,
      logoUrl: null,
      ctaLabel: 'Fale com a gente',
      contactLink,
      products: [],
      testimonials: [],
      form: null,
      eventDate: null,
      pageTitle: dto.pageTitle || 'Página',
    })
    const slots = collectSlots(fragment)
    const copy = await structuredCall({
      provider: call.value.provider,
      model: call.value.model.model,
      system: buildSectionCopySystem({ ...context, prompt: dto.prompt }),
      message: ['Campos:', describeSlots(slots)].join('\n'),
      schemaName: 'site_section_copy',
      jsonSchema: FIELDS_JSON_SCHEMA,
      schema: FieldsOutputSchema,
      maxTokens: SECTION_MAX_TOKENS,
      validate: (value) => checkFields(slots, value.fields),
      onUsage: meter.onUsage,
    })
    if (!copy.ok && !copy.partial) {
      logger.warn('site_ai.section_copy_failed', {
        component: COMPONENT,
        workspaceId,
        reason: copy.reason,
      })
      return err(aiFailed())
    }
    const fields = copy.ok
      ? copy.value.fields
      : (copy.partial as { fields: Array<{ id: string; text: string }> }).fields
    fillSlots(fragment.nodes, slots, fields)
    replaceSampleBrand(fragment.nodes, site.value.name)
    fixLinks(fragment.nodes, contactLink)

    const checked = validateSiteDocument(fragmentDocument(fragment))
    if (!checked.ok) {
      logger.error('site_ai.invalid_section', {
        component: COMPONENT,
        workspaceId,
        section: choice.value.section,
        issues: checked.error.slice(0, 3),
      })
      return err(aiFailed('A IA não montou uma seção válida — tente de novo'))
    }
    logger.info('site_ai.section', {
      component: COMPONENT,
      workspaceId,
      siteId,
      section: choice.value.section,
      kit: kit.id,
      costUsd: meter.cost(),
    })
    return ok({
      reply:
        clip(choice.value.reply, 300) || 'Pronto! Insira a seção na página.',
      fragment,
      costUsd: meter.cost(),
    })
  },

  /** "Reescrever textos da página": new copy for every text field (or the
   * selection), returned as `update` changes the editor applies as one
   * undoable step. Real data (products, testimonials, logo) is skipped. */
  async rewritePage(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: RewriteSitePageDTO,
  ): Promise<Result<SiteAiRewriteResultDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const doc = checkInputDocument(dto.document)
    if (!doc.ok) return doc
    const slots = collectSlots(doc.value, {
      within: dto.nodeIds,
      textOnly: true,
    }).slice(0, MAX_REWRITE_SLOTS)
    if (slots.length === 0) {
      return err(validationError('Não há textos para reescrever aqui'))
    }
    const call = await prepareCall(actorId, workspaceId)
    if (!call.ok) return call

    const meter = usageMeter(call.value, workspaceId, actorId)
    const answer = await structuredCall({
      provider: call.value.provider,
      model: call.value.model.model,
      system: buildRewriteSystem({
        siteName: site.value.name,
        tone: dto.tone,
        length: dto.length,
        instructions: dto.instructions,
      }),
      message: ['Campos:', describeSlots(slots)].join('\n'),
      schemaName: 'site_page_rewrite',
      jsonSchema: FIELDS_JSON_SCHEMA,
      schema: FieldsOutputSchema,
      maxTokens: REWRITE_MAX_TOKENS,
      validate: (value) => checkFields(slots, value.fields),
      onUsage: meter.onUsage,
    })
    const fields = answer.ok ? answer.value.fields : answer.partial?.fields
    if (!fields) return err(aiFailed())

    const applied = applySlots(doc.value.nodes, slots, fieldValues(fields))
    const changes: SiteAiNodeChange[] = Object.values(applied.nodes).map(
      (node) => {
        const keys = new Set(
          slots
            .filter((slot) => slot.nodeId === node.id)
            .map((slot) => String(slot.path[0])),
        )
        return {
          nodeId: node.id,
          set: Object.fromEntries(
            [...keys].map((key) => [key, node.props[key]]),
          ),
        }
      },
    )
    logger.info('site_ai.rewrite', {
      component: COMPONENT,
      workspaceId,
      siteId,
      tone: dto.tone,
      length: dto.length,
      fields: applied.applied.length,
      costUsd: meter.cost(),
    })
    return ok({
      changes,
      rewritten: applied.applied.length,
      costUsd: meter.cost(),
    })
  },

  /** "Sugerir imagens": for each image, a pick from the media library or
   * the placeholders plus an alt text and the ideal photo. */
  async suggestImages(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: SuggestSiteImagesDTO,
  ): Promise<Result<SiteAiImagesResultDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site
    const doc = checkInputDocument(dto.document)
    if (!doc.ok) return doc
    const targets = collectImageTargets(doc.value, dto.nodeIds)
    if (targets.length === 0) {
      return err(validationError('Não há imagens para sugerir aqui'))
    }
    const call = await prepareCall(actorId, workspaceId)
    if (!call.ok) return call

    const [library, pages] = await Promise.all([
      SiteMediaService.list(actorId, workspaceId),
      SitePageRepository.listWithDocuments(siteId),
    ])
    if (!pages.ok) return pages
    if (!library.ok) {
      logger.warn('site_ai.media_unavailable', {
        component: COMPONENT,
        workspaceId,
        code: library.error.code,
      })
    }
    const descriptions = libraryDescriptions([
      doc.value,
      ...pages.value.map((page) => page.document as unknown as CanvasDocument),
    ])
    const candidates = buildCandidates(
      (library.ok ? library.value : []).map((item) => ({
        url: item.url,
        description: descriptions.get(item.url) ?? null,
      })),
    )

    const meter = usageMeter(call.value, workspaceId, actorId)
    const answer = await structuredCall({
      provider: call.value.provider,
      model: call.value.model.model,
      system: buildImagesSystem(site.value.name),
      message: describeImageRequest(targets, candidates),
      schemaName: 'site_images',
      jsonSchema: IMAGES_JSON_SCHEMA,
      schema: ImagesOutputSchema,
      maxTokens: IMAGES_MAX_TOKENS,
      validate: (value) => {
        const answered = new Set(value.images.map((item) => item.id))
        const missing = targets.filter((target) => !answered.has(target.id))
        return missing.length === 0
          ? []
          : [
              `Faltaram estas imagens (devolva todas): ${missing.map((target) => target.id).join(', ')}`,
            ]
      },
      onUsage: meter.onUsage,
    })
    const images = answer.ok ? answer.value.images : answer.partial?.images
    if (!images) return err(aiFailed())

    const suggestions = toImageSuggestions(images, targets, candidates)
    logger.info('site_ai.images', {
      component: COMPONENT,
      workspaceId,
      siteId,
      images: targets.length,
      suggestions: suggestions.length,
      library: candidates.filter((item) => item.source === 'library').length,
      costUsd: meter.cost(),
    })
    return ok({ suggestions, costUsd: meter.cost() })
  },
}
