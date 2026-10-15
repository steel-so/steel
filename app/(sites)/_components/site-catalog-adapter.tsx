import type { ReactNode } from 'react'
import { CrmPublicFormRenderer } from '@/app/_components/crm/crm-public-form-renderer'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { resolveSiteHref } from '@/src/lib/sites/host'
import type { SiteSnapshotPage } from '@/src/lib/sites/snapshot'
import type { SiteFormData } from '@/src/services/site-public.service'

/**
 * Local stand-in for the `site` catalog's output renderer and CSS compiler.
 *
 * TODO(sites-integration): when src/lib/canvas-site lands, `renderSiteNode`
 * becomes `siteCatalog.components[node.type].render({ node, children,
 * breakpoint: 'base', editing: false })` (with the catalog's own render
 * context for forms, menus and links) and `siteStylesheet` becomes the
 * catalog's CSS compiler (doc + theme → classes + media queries). The walker
 * in `site-document.tsx`, the cached loaders and the page stay as they are.
 */

export interface SiteRenderContext {
  /** Prefix of internal links (`''` on the site's host, `/s/<slug>` else). */
  linkBase: string
  pages: SiteSnapshotPage[]
  forms: Record<string, SiteFormData>
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

type Link = { label: string; href: string }

function linksOf(value: unknown): Link[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is Link =>
      typeof item?.label === 'string' && typeof item?.href === 'string',
  )
}

/** Visible text of a rich-text value: tags dropped, never injected. */
function plainText(props: Record<string, unknown>): string | undefined {
  const text = str(props.text)
  if (text) return text
  const html = str(props.html)
  return html
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function Menu({
  links,
  ctx,
  column,
}: {
  links: Link[]
  ctx: SiteRenderContext
  column: boolean
}) {
  const list = (
    <ul className='ss-menu-list' data-direction={column ? 'column' : 'row'}>
      {links.map((link) => (
        <li key={`${link.href}-${link.label}`}>
          <a href={resolveSiteHref(link.href, ctx.linkBase)}>{link.label}</a>
        </li>
      ))}
    </ul>
  )
  if (column) return <nav className='ss-menu'>{list}</nav>
  return (
    <nav className='ss-menu' aria-label='Menu principal'>
      <div className='ss-menu-desktop'>{list}</div>
      <details className='ss-menu-mobile'>
        <summary aria-label='Abrir menu'>
          <span aria-hidden='true'>☰</span>
        </summary>
        {list}
      </details>
    </nav>
  )
}

function pageLinks(ctx: SiteRenderContext): Link[] {
  return ctx.pages
    .filter((page) => page.parentId === null && !page.seo.noindex)
    .map((page) => ({
      label: page.title,
      href: page.isHome ? '/' : `/${page.path}`,
    }))
}

export function renderSiteNode(
  node: CanvasNode,
  children: ReactNode,
  ctx: SiteRenderContext,
): ReactNode {
  const props = node.props
  switch (node.type) {
    case 'site.page':
      return children
    case 'site.section':
      return (
        <section
          className='ss-section'
          id={str(props.anchorId)}
          data-tone={str(props.tone) ?? 'default'}
        >
          <div className='ss-inner'>{children}</div>
        </section>
      )
    case 'site.container':
    case 'site.columns': {
      if (props.layout === 'grid' || node.type === 'site.columns') {
        const columns = Math.min(6, Math.max(1, num(props.columns, 2)))
        return <div className={`ss-grid ss-cols-${columns}`}>{children}</div>
      }
      return (
        <div
          className={props.direction === 'row' ? 'ss-row' : 'ss-stack'}
          data-align={str(props.align) ?? 'start'}
        >
          {children}
        </div>
      )
    }
    case 'site.heading': {
      const level = Math.min(6, Math.max(1, num(props.level, 2)))
      const Tag = `h${level}` as 'h1'
      return <Tag className='ss-heading'>{plainText(props)}</Tag>
    }
    case 'site.text':
      return (
        <p className='ss-text' data-variant={str(props.variant) ?? 'body'}>
          {plainText(props)}
        </p>
      )
    case 'site.button': {
      const label = str(props.label)
      if (!label) return null
      return (
        <a
          className='ss-button'
          data-variant={str(props.variant) ?? 'primary'}
          href={resolveSiteHref(str(props.href) ?? '#', ctx.linkBase)}
        >
          {label}
        </a>
      )
    }
    case 'site.image': {
      const src = str(props.src)
      if (!src) return null
      return (
        <img
          className='ss-image'
          src={src}
          alt={str(props.alt) ?? ''}
          loading='lazy'
          decoding='async'
        />
      )
    }
    case 'site.video': {
      const url = str(props.url)
      if (!url) return null
      return (
        <video
          className='ss-video'
          src={url}
          poster={str(props.poster)}
          muted
          loop
          playsInline
          controls
          preload='none'
        />
      )
    }
    case 'site.list': {
      const items = Array.isArray(props.items)
        ? props.items.filter((item): item is string => typeof item === 'string')
        : []
      return (
        <ul className='ss-list'>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )
    }
    case 'site.menu': {
      const links =
        props.source === 'links' ? linksOf(props.links) : pageLinks(ctx)
      return (
        <Menu links={links} ctx={ctx} column={props.direction === 'column'} />
      )
    }
    case 'site.social': {
      const links = Array.isArray(props.links) ? props.links : []
      return (
        <ul className='ss-social'>
          {links
            .filter(
              (link): link is { platform: string; href: string } =>
                typeof link?.platform === 'string' &&
                typeof link?.href === 'string',
            )
            .map((link) => (
              <li key={link.href}>
                <a href={link.href} rel='noopener noreferrer' target='_blank'>
                  {link.platform}
                </a>
              </li>
            ))}
        </ul>
      )
    }
    case 'site.form': {
      const data = ctx.forms[str(props.formId) ?? '']
      if (!data) return null
      return (
        <div className='ss-form'>
          <CrmPublicFormRenderer
            form={data.form}
            publicToken={data.publicToken}
          />
        </div>
      )
    }
    case 'site.divider':
      return <hr className='ss-divider' />
    case 'site.spacer':
      return <div className='ss-spacer' aria-hidden='true' />
    default:
      return children ? <div>{children}</div> : null
  }
}

/** Base stylesheet of the stand-in renderer (light, mobile first). */
export function siteStylesheet(): string {
  return `
.ss{--ss-fg:#0f172a;--ss-muted:#475569;--ss-bg:#fff;--ss-soft:#f1f5f9;--ss-accent:#1d4ed8;--ss-accent-fg:#fff;--ss-border:#e2e8f0;color:var(--ss-fg);background:var(--ss-bg);min-height:100svh;line-height:1.6;font-size:16px}
.ss *{box-sizing:border-box}
.ss-section{padding:48px 16px}
.ss-section[data-tone=accent]{background:var(--ss-soft)}
.ss-inner{max-width:1120px;margin-inline:auto;display:flex;flex-direction:column;gap:32px}
.ss-stack{display:flex;flex-direction:column;gap:16px;min-width:0}
.ss-stack[data-align=center]{align-items:center;text-align:center}
.ss-row{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:center;justify-content:space-between}
.ss-grid{display:grid;gap:24px;grid-template-columns:minmax(0,1fr)}
.ss-heading{margin:0;line-height:1.2;font-weight:700;overflow-wrap:anywhere}
h1.ss-heading{font-size:clamp(2rem,6vw,3.5rem)}
h2.ss-heading{font-size:clamp(1.6rem,4vw,2.5rem)}
h3.ss-heading{font-size:1.25rem}
h4.ss-heading,h5.ss-heading,h6.ss-heading{font-size:1rem}
.ss-text{margin:0;color:var(--ss-fg);overflow-wrap:anywhere}
.ss-text[data-variant=lead]{font-size:1.15rem;color:var(--ss-muted)}
.ss-text[data-variant=small]{font-size:.9rem;color:var(--ss-muted)}
.ss-text[data-variant=eyebrow]{font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ss-accent)}
.ss-text[data-variant=quote]{font-size:1.3rem;font-style:italic;max-width:48rem}
.ss-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 22px;border-radius:999px;background:var(--ss-accent);color:var(--ss-accent-fg);font-weight:600;text-decoration:none}
.ss-button:focus-visible,.ss a:focus-visible{outline:2px solid var(--ss-accent);outline-offset:2px}
.ss-image,.ss-video{display:block;max-width:100%;height:auto;border-radius:12px}
.ss-list{margin:0;padding-left:1.2rem;display:grid;gap:6px;text-align:left}
.ss-menu-list{list-style:none;margin:0;padding:0;display:flex;gap:8px 20px;flex-wrap:wrap}
.ss-menu-list[data-direction=column]{flex-direction:column}
.ss-menu a,.ss-social a{color:inherit;text-decoration:none;display:inline-block;padding:8px 0}
.ss-menu-desktop{display:none}
.ss-menu-mobile summary{list-style:none;cursor:pointer;font-size:1.5rem;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center}
.ss-menu-mobile[open] .ss-menu-list{flex-direction:column;padding-top:8px}
.ss-social{list-style:none;margin:0;padding:0;display:flex;gap:16px;flex-wrap:wrap}
.ss-divider{border:0;border-top:1px solid var(--ss-border);margin:0}
.ss-spacer{height:32px}
.ss-form{width:100%;max-width:36rem;text-align:left}
.ss-cookie{position:fixed;inset-inline:12px;bottom:12px;z-index:50;margin-inline:auto;max-width:42rem;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:16px;border-radius:12px;border:1px solid var(--ss-border);background:var(--ss-bg);color:var(--ss-fg);box-shadow:0 8px 24px rgb(15 23 42 / .12);font-size:.9rem}
.ss-cookie p{margin:0;flex:1 1 16rem}
.ss-cookie a{color:var(--ss-accent)}
.ss-cookie-actions{display:flex;gap:8px}
.ss-cookie button{min-height:40px;padding:8px 16px;border-radius:999px;border:1px solid var(--ss-border);background:var(--ss-bg);color:var(--ss-fg);font:inherit;cursor:pointer}
.ss-cookie button[data-primary]{background:var(--ss-accent);border-color:var(--ss-accent);color:var(--ss-accent-fg)}
.ss-404{min-height:60svh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 16px;text-align:center}
@media (min-width:768px){
.ss-section{padding:64px 24px}
.ss-cols-2,.ss-cols-3,.ss-cols-4,.ss-cols-5,.ss-cols-6{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (min-width:1024px){
.ss-section{padding:88px 32px}
.ss-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.ss-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.ss-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}
.ss-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}
.ss-menu-desktop{display:block}
.ss-menu-mobile{display:none}
}
`.trim()
}
