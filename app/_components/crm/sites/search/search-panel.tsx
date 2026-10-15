'use client'

import { ArrowRight01Icon, CodeIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  useCanvasStore,
  useCanvasStoreApi,
} from '@/app/_components/canvas/use-canvas'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmSitesKeys } from '@/src/hooks/use-crm-sites'
import {
  siteSearchApi,
  siteSearchKeys,
  useSiteSearchSettings,
} from '@/src/hooks/use-site-search'
import { cloneFragment } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { analyzeSearchPage } from '@/src/lib/sites/search/analyze'
import { extractPageContent } from '@/src/lib/sites/search/content'
import {
  renderedTitle,
  resolveBusinessProfile,
} from '@/src/lib/sites/search/context'
import {
  faqSectionFragment,
  faqSectionLocation,
  summaryFragment,
  summaryLocation,
} from '@/src/lib/sites/search/fixes'
import {
  SEARCH_PILLAR_LABELS,
  SEARCH_PILLARS,
  type SearchCheck,
  type SearchFix,
  type SearchPillar,
} from '@/src/lib/sites/search/types'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import {
  parseSearchContent,
  type SearchAiField,
  type SearchContentDTO,
  type SearchQuestionDTO,
  type StructuredDataItem,
} from '@/src/schemas/site-search.schema'
import type { SitePageSummaryDTO } from '@/types/site'
import type { SiteSearchAiOptimizeDTO } from '@/types/site-search'
import { PageSettingsDialog } from '../page-settings-dialog'
import { pagePublicPath, useSiteEditor } from '../site-editor-context'
import { AiSuggestionsDialog } from './ai-suggestions-dialog'
import { AiSummaryCard } from './ai-summary-card'
import { KeywordFields, QuestionsEditor, SummaryFields } from './search-fields'
import {
  CheckRow,
  PILLAR_HINTS,
  ScoreRing,
  SEARCH_TONE_VARS,
  sortChecks,
} from './search-ui'
import { SerpPreview, SocialPreview } from './serp-preview'
import { StructuredDataDialog } from './structured-data-dialog'

/** Drops `undefined` keys (the API stores what it gets). */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

/**
 * "Buscadores" tab of the site editor: the SEO, AEO and GEO scores of the
 * page being edited, computed live from the canvas document with the same
 * pure checks as the site report, plus the page's search data (keyword,
 * questions, summary, structured data) and one-click fixes.
 */
export function SearchPanel() {
  const editor = useSiteEditor()
  if (editor.target.kind !== 'page') {
    return (
      <p className='p-4 text-muted-foreground text-sm'>
        Abra uma página para ver como ela aparece nos buscadores.
      </p>
    )
  }
  const page = editor.pages.find((item) => item.id === editor.target.id)
  if (!page) return null
  return <PageSearch page={page} />
}

function PageSearch({ page }: { page: SitePageSummaryDTO }) {
  const { site, pages, globals, api, setPages, workspaceId, slug, canEdit } =
    useSiteEditor()
  const store = useCanvasStoreApi()
  const queryClient = useQueryClient()
  const doc = useDeferredValue(useCanvasStore((state) => state.doc))
  const searchApi = useMemo(() => siteSearchApi(workspaceId), [workspaceId])
  const settingsQuery = useSiteSearchSettings(workspaceId, site.id)
  const keywordId = useId()
  const aeoRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<SearchPillar>('seo')
  const [busy, setBusy] = useState(false)
  const [structuredOpen, setStructuredOpen] = useState(false)
  const [settingsPage, setSettingsPage] = useState<SitePageSummaryDTO | null>(
    null,
  )
  const [suggestions, setSuggestions] =
    useState<SiteSearchAiOptimizeDTO | null>(null)

  const search = useMemo(() => parseSearchContent(page.seo.search), [page.seo])
  const path = pagePublicPath(page)
  const pageUrl = `${site.url.replace(/\/$/, '')}${path === '/' ? '' : path}`
  // Business profile as saved (the report screen edits it); the editor
  // only reads it.
  const settings = useMemo(
    () =>
      settingsQuery.data
        ? {
            ...site.settings,
            search: {
              ...settingsQuery.data.settings,
              business: settingsQuery.data.prefilled
                ? {}
                : settingsQuery.data.settings.business,
            },
          }
        : site.settings,
    [site.settings, settingsQuery.data],
  )
  const chromeText = useMemo(
    () =>
      globals
        .filter(
          (global) => global.kind === 'HEADER' || global.kind === 'FOOTER',
        )
        .map((global) => extractPageContent(global.document).text)
        .join(' '),
    [globals],
  )
  const analysis = useMemo(
    () =>
      analyzeSearchPage({
        page: {
          id: page.id,
          title: page.title,
          slug: page.slug,
          isHome: page.isHome,
          seo: page.seo,
          updatedAt: page.updatedAt,
        },
        document: doc as CanvasDocument,
        site: { name: site.name, settings, pageUrl },
        siblings: pages
          .filter((other) => other.id !== page.id)
          .map((other) => ({
            id: other.id,
            title: other.title,
            seo: other.seo,
          })),
        chromeText,
        now: new Date(),
      }),
    [page, doc, site.name, settings, pageUrl, pages, chromeText],
  )

  const title = renderedTitle(site.settings, page)
  const description =
    page.seo.description || site.settings.seo.description || ''
  const socialImage =
    page.seo.socialImageUrl || site.settings.socialImageUrl || null

  const saveSeo = useCallback(
    async (patch: {
      title?: string
      description?: string
      search?: Partial<SearchContentDTO>
    }): Promise<boolean> => {
      const nextSearch = patch.search
        ? compact({ ...search, ...patch.search })
        : search
      const seo: SitePageSeoDTO = compact({
        ...page.seo,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        search: nextSearch,
      })
      try {
        const saved = await api.updatePage(site.id, page.id, { seo })
        setPages(
          pages.map((item) =>
            item.id === saved.id
              ? { ...item, seo: saved.seo, updatedAt: saved.updatedAt }
              : item,
          ),
        )
        void queryClient.invalidateQueries({
          queryKey: siteSearchKeys.report(workspaceId, site.id),
        })
        return true
      } catch (error) {
        notify.error(error, 'Não foi possível salvar')
        return false
      }
    },
    [api, site.id, page, pages, search, setPages, queryClient, workspaceId],
  )
  const saveSearch = useCallback(
    (patch: Partial<SearchContentDTO>) => saveSeo({ search: patch }),
    [saveSeo],
  )

  const insertQuestions = useCallback(
    (questions: SearchQuestionDTO[]) => {
      const fragment = faqSectionFragment(questions)
      if (!fragment) {
        notify.error('Cadastre perguntas com resposta primeiro.')
        return
      }
      const { at, replaces } = faqSectionLocation(store.getState().doc)
      const done = replaces
        ? store.dispatch(
            {
              kind: 'batch',
              ops: [
                { kind: 'remove', id: replaces },
                { kind: 'insert', fragment: cloneFragment(fragment), at },
              ],
            },
            { label: 'Atualizar perguntas' },
          )
        : store.insertFragment(fragment, at) !== null
      if (done) {
        notify.success(
          replaces
            ? 'Seção de perguntas atualizada.'
            : 'Seção de perguntas inserida no fim da página.',
        )
      }
    },
    [store],
  )

  const askAi = useCallback(
    async (field: SearchAiField) => {
      setBusy(true)
      try {
        setSuggestions(
          await searchApi.aiOptimize(site.id, {
            pageIds: [page.id],
            fields: [field],
          }),
        )
      } catch (error) {
        notify.error(error, 'A IA não conseguiu sugerir melhorias')
      } finally {
        setBusy(false)
      }
    },
    [searchApi, site.id, page.id],
  )

  const openTarget = useCallback(
    (target: Extract<SearchFix, { kind: 'open' }>['target']) => {
      switch (target) {
        case 'keyword':
          document.getElementById(keywordId)?.focus()
          break
        case 'questions':
        case 'summary':
          setTab('aeo')
          requestAnimationFrame(() =>
            aeoRef.current?.scrollIntoView({
              behavior: 'smooth',
              block: 'start',
            }),
          )
          break
        case 'structured':
          setStructuredOpen(true)
          break
        case 'page-settings':
          setSettingsPage(page)
          break
        default:
          window.open(
            `/${slug}/crm/sites/${site.id}/search?tab=${target === 'business' ? 'perfil' : 'rastreadores'}`,
            '_blank',
            'noopener',
          )
      }
    },
    [keywordId, page, slug, site.id],
  )

  const onFix = useCallback(
    (fix: SearchFix, check: SearchCheck) => {
      switch (fix.kind) {
        case 'patch':
          void saveSeo(fix.set).then(
            (ok) => ok && notify.success(`${check.label}: corrigido.`),
          )
          break
        case 'canvas':
          if (
            store.dispatch(
              { kind: 'batch', ops: fix.ops },
              { label: fix.label },
            )
          ) {
            notify.success(`${check.label}: corrigido.`)
          }
          break
        case 'select':
          store.select(fix.nodeId)
          break
        case 'insert-faq':
          insertQuestions(search.questions ?? [])
          break
        case 'insert-summary': {
          const at = summaryLocation(store.getState().doc)
          if (at && search.summary) {
            store.insertFragment(summaryFragment(search.summary), at)
          }
          break
        }
        case 'open':
          openTarget(fix.target)
          break
        case 'ai':
          void askAi(fix.field)
          break
      }
    },
    [saveSeo, store, insertQuestions, search, openTarget, askAi],
  )

  const business = useMemo(
    () => resolveBusinessProfile(settings, site.name),
    [settings, site.name],
  )
  const structuredContext = useMemo(
    () => ({
      pageTitle: title,
      description,
      faqCount: extractPageContent(doc as CanvasDocument).faq.length,
      business,
    }),
    [title, description, doc, business],
  )

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col', SEARCH_TONE_VARS)}
      data-testid='search-panel'
    >
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <fieldset
          disabled={!canEdit}
          className='m-0 grid min-w-0 gap-4 border-0 p-3'
        >
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value as SearchPillar)}
          >
            <TabsList className='grid h-auto w-full grid-cols-3 gap-1 bg-transparent p-0 group-data-horizontal/tabs:h-auto'>
              {SEARCH_PILLARS.map((pillar) => (
                <TabsTrigger
                  key={pillar}
                  value={pillar}
                  className='h-auto rounded-md border py-2 data-active:border-primary group-data-horizontal/tabs:after:hidden'
                >
                  <ScoreRing
                    score={analysis[pillar].score}
                    label={SEARCH_PILLAR_LABELS[pillar]}
                    size={48}
                    active={tab === pillar}
                  />
                </TabsTrigger>
              ))}
            </TabsList>
            <p className='text-[11px] text-muted-foreground'>
              {PILLAR_HINTS[tab]}
            </p>

            <KeywordFields
              search={search}
              onSave={saveSearch}
              inputId={keywordId}
            />

            {SEARCH_PILLARS.map((pillar) => (
              <TabsContent key={pillar} value={pillar} className='grid gap-4'>
                <ul
                  className='-mx-2 grid gap-0.5'
                  aria-label={`Verificações de ${SEARCH_PILLAR_LABELS[pillar]}`}
                >
                  {sortChecks(analysis[pillar].checks).map((check) => (
                    <CheckRow
                      key={check.id}
                      check={check}
                      onFix={onFix}
                      busy={busy}
                      canFix={canEdit}
                    />
                  ))}
                </ul>
                {pillar === 'seo' ? (
                  <>
                    <SerpPreview
                      title={title}
                      description={description}
                      url={pageUrl}
                      siteName={site.name}
                    />
                    <SocialPreview
                      title={title}
                      description={description}
                      image={socialImage}
                      host={new URL(site.url).host}
                    />
                  </>
                ) : null}
                {pillar === 'aeo' ? (
                  <div ref={aeoRef} className='grid gap-4'>
                    <QuestionsEditor
                      questions={search.questions ?? []}
                      onSave={saveSearch}
                      onInsert={insertQuestions}
                    />
                    <SummaryFields search={search} onSave={saveSearch} />
                  </div>
                ) : null}
                {pillar === 'geo' ? (
                  <>
                    <AiSummaryCard
                      disabled={!canEdit}
                      run={() => searchApi.aiSummary(site.id, page.id)}
                    />
                    <div className='grid gap-1.5'>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => setStructuredOpen(true)}
                      >
                        <SteelIcon icon={CodeIcon} data-icon='inline-start' />
                        Dados estruturados (
                        {(search.structuredData ?? []).length})
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        nativeButton={false}
                        render={
                          <Link href={`/${slug}/crm/sites/${site.id}/search`} />
                        }
                      >
                        Saúde do site nos buscadores
                        <SteelIcon
                          icon={ArrowRight01Icon}
                          data-icon='inline-end'
                        />
                      </Button>
                    </div>
                  </>
                ) : null}
              </TabsContent>
            ))}
          </Tabs>
        </fieldset>
      </div>
      <StructuredDataDialog
        open={structuredOpen}
        onOpenChange={setStructuredOpen}
        items={search.structuredData ?? EMPTY_ITEMS}
        context={structuredContext}
        nodeContext={{
          pageUrl,
          pageTitle: title,
          description,
          image: socialImage ?? `${pageUrl}#og`,
          organizationId: `${site.url.replace(/\/$/, '')}/#organization`,
          dateModified: page.updatedAt,
        }}
        workspaceId={workspaceId}
        onSave={(structuredData) => saveSearch({ structuredData })}
      />
      <AiSuggestionsDialog
        result={suggestions}
        onOpenChange={(open) => {
          if (!open) setSuggestions(null)
        }}
        onApply={async (items) => {
          try {
            await searchApi.apply(site.id, { items })
            await queryClient.invalidateQueries({
              queryKey: crmSitesKeys.pages(workspaceId, site.id),
            })
            notify.success('Sugestões aplicadas.')
            return true
          } catch (error) {
            notify.error(error, 'Não foi possível aplicar as sugestões')
            return false
          }
        }}
      />
      <PageSettingsDialog
        page={settingsPage}
        onOpenChange={(open) => {
          if (!open) setSettingsPage(null)
        }}
        onSaved={() =>
          void queryClient.invalidateQueries({
            queryKey: crmSitesKeys.pages(workspaceId, site.id),
          })
        }
      />
    </div>
  )
}

const EMPTY_ITEMS: StructuredDataItem[] = []
