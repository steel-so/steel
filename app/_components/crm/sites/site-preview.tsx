'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  ComputerIcon,
  PencilEdit02Icon,
  SmartPhone01Icon,
  Tablet01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FocusedBackLink } from '@/app/_components/layout/focused-screen'
import { SITE_CHROME_CSS } from '@/app/(sites)/_components/site-chrome-css'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  crmSitesApi,
  crmSitesKeys,
  useCrmSite,
} from '@/src/hooks/use-crm-sites'
import { useSiteCmsPreview } from '@/src/hooks/use-site-blog'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { createSiteCatalog } from '@/src/lib/canvas-site/catalog'
import type { SiteCmsContext } from '@/src/lib/canvas-site/cms'
import type { SitePageLink } from '@/src/lib/canvas-site/context'
import { compileSiteCss } from '@/src/lib/canvas-site/css'
import { SiteDocument } from '@/src/lib/canvas-site/render'
import { siteRuntimeScripts } from '@/src/lib/canvas-site/runtime'
import { parseSiteTheme } from '@/src/lib/canvas-site/theme'
import { cmsResolver } from '@/src/lib/sites/blog/resolve'
import { orderPages, toPageLinks } from './site-editor-context'
import { SiteStatusBadge } from './site-status-badge'

type Device = 'base' | 'tablet' | 'mobile'

const DEVICES: Array<{
  id: Device
  label: string
  icon: IconSvgElement
  width: number | null
}> = [
  { id: 'base', label: 'Computador', icon: ComputerIcon, width: null },
  { id: 'tablet', label: 'Tablet', icon: Tablet01Icon, width: 768 },
  { id: 'mobile', label: 'Celular', icon: SmartPhone01Icon, width: 375 },
]

/** Same rendering mode as the published page (no quirks). */
const STANDARDS_DOC =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body></body></html>'

const FRAME_BASE =
  'html,body{margin:0;padding:0}body{-webkit-font-smoothing:antialiased}'

/** Page a clicked `href` points to inside the draft (by public path). */
export function pageForHref(
  href: string | null,
  links: SitePageLink[],
): SitePageLink | null {
  if (!href?.startsWith('/')) return null
  const path = href.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  return links.find((link) => link.path === path) ?? null
}

/** The draft drawn in an iframe sized like the device, so the site's
 * breakpoints apply exactly as on the published page. */
function PreviewFrame({
  docs,
  symbols,
  css,
  links,
  currentPageId,
  width,
  onNavigate,
  cms,
}: {
  /** Blog posts and collection items of the draft (slice site-blog). */
  cms?: SiteCmsContext
  docs: {
    header?: CanvasDocument
    page: CanvasDocument
    footer?: CanvasDocument
  }
  /** Reusable component masters shown by `site.symbol` instances. */
  symbols: Record<string, CanvasDocument>
  css: string
  links: SitePageLink[]
  currentPageId: string
  width: number | null
  onNavigate: (pageId: string) => void
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const [mount, setMount] = useState<{
    doc: Document
    root: HTMLElement
  } | null>(null)
  const navigate = useRef(onNavigate)
  navigate.current = onNavigate

  useLayoutEffect(() => {
    const frame = iframe.current
    if (!frame) return
    const setup = () => {
      const doc = frame.contentDocument
      // Wait for the srcdoc document: the initial about:blank one renders
      // in quirks mode, where percentage heights stretch to the viewport.
      if (!doc?.body || doc.compatMode !== 'CSS1Compat') return
      if (doc.getElementById('site-preview-root')) return
      const root = doc.createElement('div')
      root.id = 'site-preview-root'
      doc.body.appendChild(root)
      setMount({ doc, root })
    }
    setup()
    frame.addEventListener('load', setup)
    return () => frame.removeEventListener('load', setup)
  }, [])

  useEffect(() => {
    if (!mount) return
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (href?.startsWith('#')) return
      event.preventDefault()
      const page = pageForHref(href, links)
      if (page) navigate.current(page.id)
      else if (href) window.open(anchor.href, '_blank', 'noopener')
    }
    const onSubmit = (event: Event) => {
      event.preventDefault()
      notify.info(
        'Na prévia o formulário não envia. Publique para receber leads.',
      )
    }
    mount.doc.addEventListener('click', onClick)
    mount.doc.addEventListener('submit', onSubmit, true)
    return () => {
      mount.doc.removeEventListener('click', onClick)
      mount.doc.removeEventListener('submit', onSubmit, true)
    }
  }, [mount, links])

  // Each page starts at the top.
  useEffect(() => {
    mount?.doc.defaultView?.scrollTo(0, 0)
  }, [mount, currentPageId])

  // The same element scripts as the published page (carousels, tabs,
  // popups, animations…), with this page's CSP nonce, once per frame.
  // Forms stay inert in the preview.
  const docsRef = useRef(docs)
  docsRef.current = docs
  useEffect(() => {
    if (!mount) return
    const { header, page, footer } = docsRef.current
    const runtime = siteRuntimeScripts(
      [header, page, footer].filter(
        (doc): doc is CanvasDocument => doc !== undefined,
      ),
    )
    const nonce =
      document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''
    const run = (code: string) => {
      const script = mount.doc.createElement('script')
      if (nonce) script.nonce = nonce
      script.textContent = code
      mount.doc.body.appendChild(script)
    }
    if (runtime.boot) run(runtime.boot)
    for (const script of runtime.scripts) {
      if (script.id !== 'form') run(script.code)
    }
  }, [mount])

  const catalog = useMemo(
    () => createSiteCatalog({ pages: links, currentPageId, symbols, cms }),
    [links, currentPageId, symbols, cms],
  )

  return (
    <iframe
      ref={iframe}
      title='Prévia do site'
      data-testid='site-preview-frame'
      srcDoc={STANDARDS_DOC}
      className={cn(
        'block h-full border-0 bg-white',
        width ? 'rounded-lg shadow-lg ring-1 ring-border' : 'w-full',
      )}
      style={width ? { width } : undefined}
    >
      {mount &&
        createPortal(
          <>
            <style>{`${FRAME_BASE}${SITE_CHROME_CSS}${css}`}</style>
            {docs.header ? (
              <SiteDocument doc={docs.header} catalog={catalog} />
            ) : null}
            <main id='conteudo'>
              <SiteDocument doc={docs.page} catalog={catalog} />
            </main>
            {docs.footer ? (
              <SiteDocument doc={docs.footer} catalog={catalog} />
            ) : null}
          </>,
          mount.root,
        )}
    </iframe>
  )
}

/**
 * "Visualizar": the draft as visitors will see it, page by page, on
 * desktop, tablet or phone widths. Links between pages work; forms don't
 * submit.
 */
export function SitePreview({
  workspaceId,
  slug,
  siteId,
  initialPageId,
}: {
  workspaceId: string
  slug: string
  siteId: string
  initialPageId?: string
}) {
  const api = useMemo(() => crmSitesApi(workspaceId), [workspaceId])
  const { site, pages, globals } = useCrmSite(workspaceId, siteId)
  const [pageId, setPageId] = useState<string | null>(initialPageId ?? null)
  const [device, setDevice] = useState<Device>('base')

  const home =
    pages.data?.find((page) => page.id === site.data?.homePageId) ??
    pages.data?.find((page) => page.isHome) ??
    pages.data?.[0]
  const currentId =
    pageId && pages.data?.some((page) => page.id === pageId) ? pageId : home?.id

  const page = useQuery({
    queryKey: crmSitesKeys.page(workspaceId, siteId, currentId ?? ''),
    queryFn: () => api.page(siteId, currentId ?? ''),
    enabled: Boolean(currentId),
  })

  const links = useMemo(() => toPageLinks(pages.data ?? []), [pages.data])
  const cmsPreview = useSiteCmsPreview(workspaceId, siteId)
  const cms = useMemo(
    () =>
      cmsPreview.data
        ? cmsResolver({
            blog: cmsPreview.data.blog,
            collections: cmsPreview.data.collections,
            request: { path: '/', blogRoute: null, page: 1, query: '' },
            href: (path) => path,
            timezone: site.data?.settings.timezone,
            sample: cmsPreview.data.sample,
          })
        : undefined,
    [cmsPreview.data, site.data?.settings.timezone],
  )
  const theme = useMemo(
    () => parseSiteTheme(site.data?.theme ?? {}),
    [site.data?.theme],
  )
  const header = globals.data?.find((global) => global.kind === 'HEADER')
  const footer = globals.data?.find((global) => global.kind === 'FOOTER')
  const symbols = useMemo(() => {
    const out: Record<string, CanvasDocument> = {}
    for (const global of globals.data ?? []) {
      if (global.kind === 'SYMBOL') out[global.id] = global.document
    }
    return out
  }, [globals.data])
  const docs = useMemo(
    () =>
      page.data
        ? {
            header: header?.document,
            page: page.data.document,
            footer: footer?.document,
          }
        : null,
    [page.data, header, footer],
  )
  const css = useMemo(
    () =>
      docs
        ? compileSiteCss(
            [
              ...[docs.header, docs.page, docs.footer].filter(
                (doc): doc is CanvasDocument => doc !== undefined,
              ),
              ...Object.values(symbols),
            ],
            { theme },
          )
        : '',
    [docs, theme, symbols],
  )

  // Keep the address in sync (shareable with the team, survives reload).
  useEffect(() => {
    if (!currentId) return
    const url = new URL(window.location.href)
    url.searchParams.set('page', currentId)
    window.history.replaceState(null, '', url)
  }, [currentId])

  const failed = site.error || pages.error || globals.error || page.error
  const width = DEVICES.find((item) => item.id === device)?.width ?? null
  const editorHref = `/${slug}/crm/sites/${siteId}${currentId ? `?page=${currentId}` : ''}`

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3'>
        <FocusedBackLink href={editorHref} label='Voltar ao editor' />
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='hidden truncate font-medium text-sm sm:block'>
            {site.data?.name ?? 'Site'}
          </span>
          <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
            Prévia do rascunho
          </span>
          {site.data ? (
            <SiteStatusBadge
              status={site.data.status}
              className='hidden md:inline-flex'
            />
          ) : null}
        </div>
        {pages.data && currentId ? (
          <Select
            value={currentId}
            onValueChange={(next) =>
              typeof next === 'string' && setPageId(next)
            }
          >
            <SelectTrigger
              size='sm'
              aria-label='Página'
              className='h-8 w-36 text-xs sm:w-48'
            >
              <SelectValue>
                {(value: string | null) =>
                  pages.data?.find((item) => item.id === value)?.title ??
                  'Página'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {orderPages(pages.data).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <span style={{ paddingLeft: item.depth * 12 }}>
                    {item.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div
          role='toolbar'
          aria-label='Tamanho de tela'
          className='hidden items-center gap-0.5 rounded-md bg-muted p-0.5 md:flex'
        >
          {DEVICES.map((item) => (
            <button
              key={item.id}
              type='button'
              aria-pressed={device === item.id}
              aria-label={item.label}
              title={item.label}
              onClick={() => setDevice(item.id)}
              className={cn(
                'flex h-7 w-8 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                device === item.id && 'bg-background text-foreground shadow-xs',
              )}
            >
              <SteelIcon icon={item.icon} className='size-4' />
            </button>
          ))}
        </div>
        <Button
          size='sm'
          variant='outline'
          className='hidden sm:inline-flex'
          nativeButton={false}
          render={<Link href={editorHref} />}
        >
          <SteelIcon icon={PencilEdit02Icon} data-icon='inline-start' />
          Editar
        </Button>
      </header>
      <div
        className={cn(
          'flex min-h-0 flex-1 justify-center overflow-hidden',
          width && 'bg-muted/50 p-4',
        )}
      >
        {failed ? (
          <p className='self-center px-6 text-center text-muted-foreground text-sm'>
            Não foi possível carregar a prévia deste site.
          </p>
        ) : docs && currentId ? (
          <PreviewFrame
            // A fresh frame per page: the element scripts run once per
            // document (they bind document-level listeners).
            key={currentId}
            docs={docs}
            symbols={symbols}
            css={css}
            links={links}
            currentPageId={currentId}
            width={width}
            onNavigate={setPageId}
            cms={cms}
          />
        ) : (
          <Skeleton className='m-4 h-auto w-full max-w-5xl' />
        )}
      </div>
    </div>
  )
}
