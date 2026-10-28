'use client'

import {
  AiMagicIcon,
  ComponentIcon,
  Database01Icon,
  Files01Icon,
  FlaskConicalIcon,
  Image01Icon,
  LayoutTopIcon,
  News01Icon,
  PaintBoardIcon,
  SearchFocusIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import type { CanvasCollaboration } from '@/app/_components/canvas/collab/collab-context'
import type {
  CanvasPresetItem,
  CanvasSidebarTab,
} from '@/app/_components/canvas/types'
import { useCanvasStore } from '@/app/_components/canvas/use-canvas'
import { SiteSnapshot } from '@/app/_components/canvas-site/site-snapshot'
import {
  useCan,
  useIsPrivileged,
} from '@/app/_components/workspace/workspace-permissions'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import {
  crmSitesApi,
  crmSitesKeys,
  useCrmSite,
  useSiteForms,
} from '@/src/hooks/use-crm-sites'
import { useLiveSiteNewsletters } from '@/src/hooks/use-site-newsletters'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import { canvasDocumentName } from '@/src/lib/canvas-collab/names'
import { createSiteCatalog, siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_VIEWPORT_WIDTHS } from '@/src/lib/canvas-site/constants'
import type { SiteLiveForm } from '@/src/lib/canvas-site/context'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import { SITE_PRESETS } from '@/src/lib/canvas-site/presets'
import { SiteDocument } from '@/src/lib/canvas-site/render'
import {
  parseSiteTheme,
  SITE_FONTS,
  type SiteTheme,
  siteColorTokens,
} from '@/src/lib/canvas-site/theme'
import type { SiteGlobalDTO, SitePageSummaryDTO } from '@/types/site'
import { SiteAiPanel } from './ai/site-ai-panel'
import { BlogPanel } from './blog/blog-panel'
import { CollectionsPanel } from './blog/collections-panel'
import {
  SiteBlogCategoryPicker,
  SiteBlogTagPicker,
  SiteCollectionFieldPicker,
  SiteCollectionPicker,
  useEditorCms,
} from './blog/editor-cms'
import {
  SiteAnchorPicker,
  SiteChildAdder,
  SiteWhatsappPicker,
} from './element-controls'
import { AbPanel } from './experiments/ab-panel'
import { SiteFormPicker } from './form-picker'
import { GlobalsPanel } from './globals-panel'
import { MediaPanel } from './media-panel'
import { SiteNewsletterPicker } from './newsletter-picker'
import { PagesPanel } from './pages-panel'
import { SearchPanel } from './search/search-panel'
import {
  type SiteEditorContextValue,
  SiteEditorProvider,
  type SiteEditorTarget,
  toPageLinks,
  useSiteEditor,
} from './site-editor-context'
import { SiteEditorActions, SiteEditorTitle } from './site-top-bar'
import { SymbolOverridesControl } from './symbol-overrides-control'
import { SymbolsPanel } from './symbols-panel'
import { ThemePanel } from './theme-panel'
import { useOpenTarget } from './use-open-target'

/** Theme edits are saved this long after the last change. */
export const THEME_SAVE_MS = 800

const TAB_ICONS = {
  'site-pages': Files01Icon,
  'site-theme': PaintBoardIcon,
  'site-globals': LayoutTopIcon,
  'site-media': Image01Icon,
  'site-symbols': ComponentIcon,
  'site-blog': News01Icon,
  'site-collections': Database01Icon,
  'site-ai': AiMagicIcon,
  'site-search': SearchFocusIcon,
  'site-ab': FlaskConicalIcon,
}

const TABS: CanvasSidebarTab[] = [
  {
    id: 'site-pages',
    label: 'Páginas',
    icon: 'site-pages',
    render: () => <PagesPanel />,
  },
  {
    id: 'site-theme',
    label: 'Tema',
    icon: 'site-theme',
    render: () => <ThemePanel />,
  },
  {
    id: 'site-globals',
    label: 'Globais',
    icon: 'site-globals',
    render: () => <GlobalsPanel />,
  },
  {
    id: 'site-media',
    label: 'Mídia',
    icon: 'site-media',
    render: () => <MediaPanel />,
  },
  {
    id: 'site-symbols',
    label: 'Componentes',
    icon: 'site-symbols',
    render: () => <SymbolsPanel />,
  },
  {
    id: 'site-blog',
    label: 'Blog',
    icon: 'site-blog',
    render: () => <BlogPanel />,
  },
  {
    id: 'site-collections',
    label: 'Coleções',
    icon: 'site-collections',
    render: () => <CollectionsPanel />,
  },
  {
    id: 'site-ai',
    label: 'IA',
    icon: 'site-ai',
    render: ({ store }) => <SiteAiPanel store={store} />,
  },
  {
    id: 'site-search',
    label: 'Buscadores',
    icon: 'site-search',
    render: () => <SearchPanel />,
  },
  {
    id: 'site-ab',
    label: 'Testes A/B',
    icon: 'site-ab',
    render: () => <AbPanel />,
  },
]

const FONTS = SITE_FONTS.map((font) => ({
  label: font.label,
  value: font.stack,
}))

/** A preset fragment as a one-section page document (thumbnail). */
export function fragmentDocument(fragment: CanvasFragment): CanvasDocument {
  return {
    catalog: 'site',
    version: 1,
    rootId: '__preview_root',
    nodes: {
      ...fragment.nodes,
      __preview_root: {
        id: '__preview_root',
        type: 'site.page',
        props: siteCatalog.components['site.page'].defaultProps(),
        children: fragment.roots ?? [fragment.rootId],
      },
    },
  }
}

function PresetPreview({
  fragment,
  theme,
}: {
  fragment: () => CanvasFragment
  theme: SiteTheme
}) {
  const docs = useMemo(() => [fragmentDocument(fragment())], [fragment])
  return (
    <SiteSnapshot
      docs={docs}
      theme={theme}
      className='size-full self-stretch bg-white'
    />
  )
}

/** Stylesheet of the canvas iframe: theme, the page and the globals drawn
 * around it, compiled together like the published page. */
function SiteEditorFrameStyles({
  theme,
  around,
}: {
  theme: SiteTheme
  around: CanvasDocument[]
}) {
  const doc = useCanvasStore((state) => state.doc)
  const css = useMemo(
    () => compileSiteCss([...around, doc], { theme, editing: true }),
    [around, doc, theme],
  )
  return <style data-site-css=''>{css}</style>
}

/** Header/footer drawn around the page in the canvas, read-only, with a
 * shortcut to edit it. */
function GlobalBand({
  global,
  catalog,
}: {
  global: SiteGlobalDTO
  catalog: CanvasCatalog
}) {
  const openTarget = useOpenTarget()
  const onEdit = () => void openTarget({ kind: 'global', id: global.id })
  const label = global.kind === 'HEADER' ? 'cabeçalho' : 'rodapé'
  return (
    <div
      data-site-global={global.kind.toLowerCase()}
      style={{ position: 'relative' }}
      className='site-global-band'
    >
      <style>
        {
          '.site-global-band:hover{outline:2px dashed #8b8fa3;outline-offset:-2px}.site-global-band>button{position:absolute;top:8px;right:8px;z-index:5;display:none;padding:6px 10px;border-radius:6px;border:0;background:#161c2d;color:#fff;font:600 12px/1.2 system-ui,sans-serif;cursor:pointer}.site-global-band:hover>button,.site-global-band>button:focus-visible{display:block}'
        }
      </style>
      <div style={{ pointerEvents: 'none' }}>
        <SiteDocument doc={global.document} catalog={catalog} />
      </div>
      <button type='button' onClick={onEdit}>
        Editar {label} global
      </button>
    </div>
  )
}

function useLiveForms(workspaceId: string): Record<string, SiteLiveForm> {
  const forms = useSiteForms(workspaceId)
  return useMemo(() => {
    const out: Record<string, SiteLiveForm> = {}
    for (const form of forms.data ?? []) {
      if (form.status !== 'PUBLISHED') continue
      out[form.publicToken] = {
        fields: form.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          placeholder: field.placeholder,
          options: field.options,
        })),
        successMessage: form.successMessage,
        redirectUrl: form.redirectUrl,
      }
    }
    return out
  }, [forms.data])
}

/** The canvas of the current target (remounted when it changes). */
function SiteCanvas({
  document,
  collabUser,
}: {
  document: CanvasDocument
  collabUser?: CanvasCollaboration['user']
}) {
  const { site, globals, target, theme, api, workspaceId, pageLinks } =
    useSiteEditor()
  const queryClient = useQueryClient()
  const canEmbed = useIsPrivileged()
  const forms = useLiveForms(workspaceId)
  const newsletters = useLiveSiteNewsletters(workspaceId)
  // Blog posts and collection items the blog/collection elements show.
  const cms = useEditorCms(
    workspaceId,
    site.id,
    target,
    globals,
    site.settings.timezone,
  )
  // Blog/collection templates are pages too: drawn inside the header/footer.
  const withChrome =
    target.kind === 'page' ||
    globals.some(
      (global) => global.id === target.id && global.kind === 'TEMPLATE',
    )

  // Reusable components drawn by `site.symbol` instances (live masters).
  const symbols = useMemo(() => {
    const out: Record<string, CanvasDocument> = {}
    for (const global of globals) {
      if (global.kind === 'SYMBOL') out[global.id] = global.document
    }
    return out
  }, [globals])

  const catalog = useMemo(() => {
    const base = createSiteCatalog({
      pages: pageLinks,
      currentPageId: target.kind === 'page' ? target.id : undefined,
      canEmbed,
      formPicker: SiteFormPicker,
      newsletterPicker: SiteNewsletterPicker,
      newsletters,
      siteId: site.id,
      timeZone: site.settings.timezone,
      anchorPicker: SiteAnchorPicker,
      whatsappPicker: SiteWhatsappPicker,
      childAdder: SiteChildAdder,
      forms,
      symbols,
      symbolControl: SymbolOverridesControl,
      cms,
      blogCategoryPicker: SiteBlogCategoryPicker,
      blogTagPicker: SiteBlogTagPicker,
      collectionPicker: SiteCollectionPicker,
      collectionFieldPicker: SiteCollectionFieldPicker,
    })
    return { ...base, icons: { ...base.icons, ...TAB_ICONS } }
  }, [
    pageLinks,
    target,
    canEmbed,
    forms,
    symbols,
    cms,
    newsletters,
    site.id,
    site.settings.timezone,
  ])

  const header = globals.find((global) => global.kind === 'HEADER')
  const footer = globals.find((global) => global.kind === 'FOOTER')
  const around = useMemo(
    () => [
      ...(withChrome
        ? [header?.document, footer?.document].filter(
            (doc): doc is CanvasDocument => doc !== undefined,
          )
        : []),
      // Styles of every component master, for the instances on the canvas.
      ...Object.values(symbols),
    ],
    [withChrome, header, footer, symbols],
  )

  const tokens = useMemo(() => siteColorTokens(theme), [theme])
  const presets = useMemo<CanvasPresetItem[]>(
    () =>
      // Layout blocks are empty grids: their icon says more than a blank
      // miniature. Sections are drawn with the site's theme.
      SITE_PRESETS.map((preset) =>
        preset.sectionType
          ? {
              ...preset,
              preview: () => (
                <PresetPreview fragment={preset.fragment} theme={theme} />
              ),
            }
          : preset,
      ),
    [theme],
  )

  const onSave = useCallback(
    async (doc: CanvasDocument) => {
      try {
        if (target.kind === 'page') {
          const saved = await api.updatePage(site.id, target.id, {
            document: doc,
          })
          queryClient.setQueryData(
            crmSitesKeys.page(workspaceId, site.id, target.id),
            saved,
          )
        } else {
          const saved = await api.updateGlobal(site.id, target.id, {
            document: doc,
          })
          queryClient.setQueryData(
            crmSitesKeys.globals(workspaceId, site.id),
            (current: SiteGlobalDTO[] | undefined) =>
              current?.map((global) =>
                global.id === saved.id ? saved : global,
              ),
          )
        }
        return true
      } catch (error) {
        notify.error(error, 'Não foi possível salvar')
        return false
      }
    },
    [api, site.id, target, queryClient, workspaceId],
  )

  // Read once on mount (the canvas remounts per target).
  const [collaboration] = useState<CanvasCollaboration | undefined>(() =>
    collabUser
      ? {
          documentName: canvasDocumentName(
            target.kind === 'page' ? 'site-page' : 'site-global',
            target.id,
          ),
          user: collabUser,
        }
      : undefined,
  )

  return (
    <CanvasEditor
      catalog={catalog}
      initialDocument={document}
      collaboration={collaboration}
      viewportWidths={SITE_VIEWPORT_WIDTHS}
      presets={presets}
      extraTabs={TABS}
      colorTokens={tokens}
      fonts={FONTS}
      frameHead={<SiteEditorFrameStyles theme={theme} around={around} />}
      frameBefore={
        header && withChrome ? (
          <GlobalBand global={header} catalog={catalog} />
        ) : null
      }
      frameAfter={
        footer && withChrome ? (
          <GlobalBand global={footer} catalog={catalog} />
        ) : null
      }
      title={<SiteEditorTitle />}
      actions={() => <SiteEditorActions />}
      onSave={onSave}
      onUploadImage={async (file) => {
        try {
          const item = await api.uploadMedia(file)
          void queryClient.invalidateQueries({
            queryKey: crmSitesKeys.media(workspaceId),
          })
          return item.url
        } catch (error) {
          notify.error(error, 'Não foi possível enviar a imagem')
          return null
        }
      }}
    />
  )
}

function EditorSkeleton() {
  return (
    <div className='flex h-full flex-col' aria-busy='true'>
      <Skeleton className='h-12 w-full rounded-none' />
      <div className='flex min-h-0 flex-1 gap-px'>
        <Skeleton className='hidden w-80 rounded-none lg:block' />
        <Skeleton className='min-h-0 flex-1 rounded-none opacity-60' />
        <Skeleton className='hidden w-80 rounded-none lg:block' />
      </div>
    </div>
  )
}

function EditorMessage({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
      <p className='max-w-sm text-muted-foreground text-sm'>{children}</p>
      <Button
        variant='outline'
        size='sm'
        nativeButton={false}
        render={<Link href={`/${slug}/crm/sites`} />}
      >
        Voltar para os sites
      </Button>
    </div>
  )
}

function homeOf(pages: SitePageSummaryDTO[], homePageId: string | null) {
  return (
    pages.find((page) => page.id === homePageId) ??
    pages.find((page) => page.isHome) ??
    pages[0]
  )
}

/**
 * The site editor: `CanvasEditor` with the site catalog, the page/global
 * being edited, the theme, and the Páginas, Tema, Globais and Mídia tabs.
 * Pages and globals are separate documents; switching saves the current
 * one and remounts the canvas on the next.
 */
export function SiteEditor({
  workspaceId,
  slug,
  siteId,
  initialPageId,
  collabUser,
}: {
  workspaceId: string
  slug: string
  siteId: string
  initialPageId?: string
  /** Who is editing, for real-time co-editing (presence, outlines). */
  collabUser?: CanvasCollaboration['user']
}) {
  const api = useMemo(() => crmSitesApi(workspaceId), [workspaceId])
  const queryClient = useQueryClient()
  const { site, pages, globals } = useCrmSite(workspaceId, siteId)
  const canEdit = useCan('landing-pages', 'EDIT')
  const canDelete = useCan('landing-pages', 'DELETE')

  const [target, setTarget] = useState<SiteEditorTarget | null>(
    initialPageId ? { kind: 'page', id: initialPageId } : null,
  )
  const [epoch, setEpoch] = useState(0)
  const lastPageId = useRef<string | null>(initialPageId ?? null)
  if (target?.kind === 'page') lastPageId.current = target.id
  const [theme, setThemeState] = useState<SiteTheme | null>(null)
  const themeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingTheme = useRef<SiteTheme | null>(null)

  // Theme from the server on load and after a restore.
  const serverTheme = site.data?.theme
  useEffect(() => {
    if (serverTheme && !pendingTheme.current) {
      setThemeState(parseSiteTheme(serverTheme))
    }
  }, [serverTheme, epoch])

  // Default target: the home page.
  useEffect(() => {
    if (target || !pages.data || !site.data) return
    const home = homeOf(pages.data, site.data.homePageId)
    if (home) setTarget({ kind: 'page', id: home.id })
  }, [target, pages.data, site.data])

  // The target vanished (deleted page/global, restored version).
  useEffect(() => {
    if (!target || !pages.data || !globals.data || !site.data) return
    const exists =
      target.kind === 'page'
        ? pages.data.some((page) => page.id === target.id)
        : globals.data.some((global) => global.id === target.id)
    if (!exists) {
      const home = homeOf(pages.data, site.data.homePageId)
      setTarget(home ? { kind: 'page', id: home.id } : null)
    }
  }, [target, pages.data, globals.data, site.data])

  const page = useQuery({
    queryKey: crmSitesKeys.page(workspaceId, siteId, target?.id ?? ''),
    queryFn: () => api.page(siteId, target?.id ?? ''),
    enabled: target?.kind === 'page',
    staleTime: Number.POSITIVE_INFINITY,
  })

  const saveTheme = useCallback(async (): Promise<boolean> => {
    if (themeTimer.current) clearTimeout(themeTimer.current)
    themeTimer.current = null
    const next = pendingTheme.current
    if (!next) return true
    try {
      const saved = await api.update(siteId, { theme: next })
      if (pendingTheme.current === next) pendingTheme.current = null
      queryClient.setQueryData(crmSitesKeys.site(workspaceId, siteId), saved)
      return true
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o tema')
      return false
    }
  }, [api, siteId, queryClient, workspaceId])

  useEffect(
    () => () => {
      if (themeTimer.current) clearTimeout(themeTimer.current)
    },
    [],
  )

  const pagesData = pages.data
  const pageLinks = useMemo(() => toPageLinks(pagesData ?? []), [pagesData])

  const value = useMemo<SiteEditorContextValue | null>(() => {
    if (!site.data || !pagesData || !globals.data || !target || !theme) {
      return null
    }
    return {
      workspaceId,
      slug,
      site: site.data,
      pages: pagesData,
      globals: globals.data,
      pageLinks,
      target,
      lastPageId:
        lastPageId.current ??
        homeOf(pagesData, site.data.homePageId)?.id ??
        target.id,
      theme,
      canEdit,
      canDelete,
      api,
      open: async (next) => {
        if (next.kind === target.kind && next.id === target.id) return
        setTarget(next)
      },
      setTheme: (next) => {
        setThemeState(next)
        pendingTheme.current = next
        if (themeTimer.current) clearTimeout(themeTimer.current)
        themeTimer.current = setTimeout(() => void saveTheme(), THEME_SAVE_MS)
      },
      flushTheme: saveTheme,
      setSite: (next) =>
        queryClient.setQueryData(crmSitesKeys.site(workspaceId, siteId), next),
      setPages: (next) =>
        queryClient.setQueryData(crmSitesKeys.pages(workspaceId, siteId), next),
      setGlobals: (next) =>
        queryClient.setQueryData(
          crmSitesKeys.globals(workspaceId, siteId),
          next,
        ),
      reload: async () => {
        pendingTheme.current = null
        await queryClient.invalidateQueries({
          queryKey: crmSitesKeys.site(workspaceId, siteId),
        })
        setEpoch((current) => current + 1)
      },
      previewHref: (pageId) =>
        `/${slug}/crm/sites/${siteId}/preview${pageId ? `?page=${pageId}` : ''}`,
    }
  }, [
    site.data,
    pagesData,
    globals.data,
    target,
    theme,
    workspaceId,
    slug,
    pageLinks,
    canEdit,
    canDelete,
    api,
    saveTheme,
    queryClient,
    siteId,
  ])

  if (site.error || pages.error || globals.error) {
    const error = site.error ?? pages.error ?? globals.error
    const missing =
      error instanceof ApiError &&
      (error.status === 404 || error.status === 403)
    return (
      <EditorMessage slug={slug}>
        {missing
          ? 'Este site não existe mais ou você não tem acesso a ele.'
          : 'Não foi possível abrir o site. Tente novamente em instantes.'}
      </EditorMessage>
    )
  }
  if (!canEdit) {
    return (
      <EditorMessage slug={slug}>
        Seu perfil pode ver os sites, mas não editá-los.{' '}
        <Link
          className='font-medium text-primary underline-offset-4 hover:underline'
          href={`/${slug}/crm/sites/${siteId}/preview`}
        >
          Ver o rascunho
        </Link>
      </EditorMessage>
    )
  }
  if (!value) return <EditorSkeleton />

  const document =
    value.target.kind === 'page'
      ? page.data?.id === value.target.id
        ? page.data.document
        : null
      : (value.globals.find((global) => global.id === value.target.id)
          ?.document ?? null)

  if (page.error && value.target.kind === 'page') {
    return (
      <EditorMessage slug={slug}>
        Não foi possível abrir esta página.
      </EditorMessage>
    )
  }

  return (
    <SiteEditorProvider value={value}>
      {document ? (
        <SiteCanvas
          key={`${value.target.kind}:${value.target.id}:${epoch}`}
          document={document}
          collabUser={collabUser}
        />
      ) : (
        <EditorSkeleton />
      )}
    </SiteEditorProvider>
  )
}
