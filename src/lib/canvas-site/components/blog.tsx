import type { ReactNode } from 'react'
import {
  type CanvasRenderProps,
  defineComponent,
  type InspectorField,
} from '@/src/lib/canvas/registry'
import type {
  SiteCmsAuthor,
  SiteCmsPostCard,
  SiteCmsPostList,
  SiteCmsTermLink,
} from '../cms'
import { SITE_TYPES } from '../constants'
import type { SiteRenderContext } from '../context'
import { classNames } from '../css'
import { IconSvg, SOCIAL_NETWORKS, type SocialNetwork } from '../icons'
import {
  ALIGN_OPTIONS,
  ASPECT_RATIO_LABELS,
  advancedSection,
  spacingSection,
} from '../inspector'
import { safeHref, safeSrc } from '../sanitize'
import { ASPECT_RATIOS } from '../schemas'
import {
  POST_LIST_SOURCES,
  type SiteBlogSearchProps,
  type SitePostAuthorProps,
  type SitePostListProps,
  type SitePostProps,
  type SitePostTermsProps,
  siteBlogSearchSchema,
  sitePostAuthorSchema,
  sitePostListSchema,
  sitePostSchema,
  sitePostTermsSchema,
} from '../schemas-cms'

/**
 * Blog elements of the site catalog (slice site-blog): post list, the
 * current post, categories/tags, blog search and author box. They read the
 * posts from `ctx.cms` (resolved before the render) and output plain
 * semantic HTML — links, `<time>`, `<article>` — that works without
 * JavaScript. With no data they show a hint in the editor and nothing (or
 * the empty text) on the site.
 */

const anchorId = (anchor: string | undefined) => anchor || undefined

function Placeholder({ label }: { label: string }) {
  return <div className='s-placeholder'>{label}</div>
}

const SOURCE_LABELS: Record<(typeof POST_LIST_SOURCES)[number], string> = {
  latest: 'Mais recentes',
  archive: 'Da página (categoria, tag, autor, busca)',
  featured: 'Em destaque',
  related: 'Relacionados ao post atual',
}

const cardStyleFields: InspectorField[] = [
  {
    path: 'background',
    label: 'Fundo do cartão',
    control: { kind: 'color', allowTokens: true, allowTransparent: true },
  },
  { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
  { path: 'border', label: 'Borda', control: { kind: 'border' } },
  { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
]

function termPickerField(
  picker: SiteRenderContext['blogCategoryPicker'],
  path: string,
  label: string,
): InspectorField {
  return {
    path,
    label,
    help: 'Deixe vazio para não filtrar.',
    control: picker
      ? { kind: 'custom', component: picker }
      : { kind: 'text', placeholder: 'slug', maxLength: 80 },
  }
}

function readingLabel(minutes: number): string {
  return `${minutes} min de leitura`
}

function PostMeta({
  post,
  showDate,
  showAuthor,
  showReadingTime,
}: {
  post: SiteCmsPostCard
  showDate: boolean
  showAuthor: boolean
  showReadingTime: boolean
}) {
  const parts: ReactNode[] = []
  if (showDate) {
    parts.push(
      <time key='date' dateTime={post.publishedAt}>
        {post.dateLabel}
      </time>,
    )
  }
  if (showReadingTime) {
    parts.push(<span key='time'>{readingLabel(post.readingMinutes)}</span>)
  }
  if (showAuthor && post.author) {
    parts.push(
      <span key='author'>
        por <a href={post.author.href}>{post.author.name}</a>
      </span>,
    )
  }
  if (parts.length === 0) return null
  return <p className='s-pmeta'>{parts}</p>
}

function TermChips({
  terms,
  className = 's-pcats',
}: {
  terms: SiteCmsTermLink[]
  className?: string
}) {
  if (terms.length === 0) return null
  return (
    <ul className={className}>
      {terms.map((term) => (
        <li key={term.id}>
          <a href={term.href}>{term.name}</a>
        </li>
      ))}
    </ul>
  )
}

function PostCard({
  post,
  p,
  lead,
}: {
  post: SiteCmsPostCard
  p: SitePostListProps
  lead: boolean
}) {
  const Title = p.titleLevel
  const cover = p.showCover ? safeSrc(post.coverUrl ?? undefined) : undefined
  return (
    <article className={lead ? 's-pcard s-pcard-lead' : 's-pcard'}>
      {cover ? (
        <div className='s-pcard-media'>
          <img
            src={cover}
            alt=''
            loading={lead ? undefined : 'lazy'}
            decoding='async'
          />
        </div>
      ) : null}
      <div className='s-pcard-body'>
        {p.showCategories ? <TermChips terms={post.categories} /> : null}
        <Title className='s-pcard-title'>
          <a href={post.href}>{post.title}</a>
        </Title>
        {p.showExcerpt && post.excerpt ? (
          <p className='s-pcard-excerpt'>{post.excerpt}</p>
        ) : null}
        <PostMeta
          post={post}
          showDate={p.showDate}
          showAuthor={p.showAuthor}
          showReadingTime={p.showReadingTime}
        />
      </div>
    </article>
  )
}

function Pager({ list }: { list: SiteCmsPostList }) {
  if (list.pageCount <= 1) return null
  return (
    <nav className='s-pager' aria-label='Paginação'>
      {list.prevHref ? (
        <a href={list.prevHref} rel='prev'>
          Anteriores
        </a>
      ) : null}
      <ol>
        {list.pages.map((item) => (
          <li key={item.page}>
            <a
              href={item.href}
              aria-current={item.page === list.page ? 'page' : undefined}
            >
              <span className='s-sr'>Página </span>
              {item.page}
            </a>
          </li>
        ))}
      </ol>
      {list.nextHref ? (
        <a href={list.nextHref} rel='next'>
          Próximos
        </a>
      ) : null}
    </nav>
  )
}

// ─── post list ────────────────────────────────────────────────────────────

export function postListDefinition(ctx: SiteRenderContext) {
  return defineComponent<SitePostListProps>({
    type: SITE_TYPES.postList,
    label: 'Lista de posts',
    icon: 'postList',
    category: 'Blog',
    keywords: ['blog', 'posts', 'artigos', 'notícias', 'últimos posts'],
    propsSchema: sitePostListSchema,
    defaultProps: () => ({
      source: 'latest',
      categorySlug: '',
      tagSlug: '',
      layout: 'grid',
      columns: { base: 3, tablet: 2, mobile: 1 },
      perPage: 6,
      pagination: false,
      featuredFirst: false,
      showCover: true,
      showExcerpt: true,
      showDate: true,
      showAuthor: false,
      showCategories: true,
      showReadingTime: true,
      showArchiveHeader: false,
      titleLevel: 'h3',
      aspectRatio: '16/9',
      gap: { base: 32, mobile: 24 },
      emptyText: 'Nenhum post publicado ainda.',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Posts',
        tab: 'content',
        fields: [
          {
            path: 'source',
            label: 'Quais posts',
            control: {
              kind: 'select',
              options: POST_LIST_SOURCES.map((value) => ({
                value,
                label: SOURCE_LABELS[value],
              })),
            },
          },
          termPickerField(
            ctx.blogCategoryPicker,
            'categorySlug',
            'Só da categoria',
          ),
          termPickerField(ctx.blogTagPicker, 'tagSlug', 'Só da tag'),
          {
            path: 'perPage',
            label: 'Posts por página',
            control: { kind: 'number', min: 1, max: 24 },
          },
          {
            path: 'pagination',
            label: 'Paginação',
            help: 'Links para as páginas seguintes (?pagina=2).',
            control: { kind: 'toggle' },
          },
          {
            path: 'showArchiveHeader',
            label: 'Título do arquivo',
            help: 'Mostra o nome da categoria, tag, autor ou busca acima da lista.',
            control: { kind: 'toggle' },
          },
          {
            path: 'emptyText',
            label: 'Texto sem posts',
            control: { kind: 'text', maxLength: 200 },
          },
        ],
      },
      {
        id: 'show',
        label: 'Mostrar',
        tab: 'content',
        fields: [
          { path: 'showCover', label: 'Capa', control: { kind: 'toggle' } },
          {
            path: 'showExcerpt',
            label: 'Resumo',
            control: { kind: 'toggle' },
          },
          { path: 'showDate', label: 'Data', control: { kind: 'toggle' } },
          {
            path: 'showReadingTime',
            label: 'Tempo de leitura',
            control: { kind: 'toggle' },
          },
          { path: 'showAuthor', label: 'Autor', control: { kind: 'toggle' } },
          {
            path: 'showCategories',
            label: 'Categorias',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'layout',
        label: 'Layout',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'Estilo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'grid', label: 'Grade' },
                { value: 'cards', label: 'Cartões' },
                { value: 'list', label: 'Lista' },
              ],
            },
          },
          {
            path: 'columns',
            label: 'Colunas',
            responsive: true,
            showIf: (props) =>
              props.layout === 'grid' || props.layout === 'cards',
            control: { kind: 'number', min: 1, max: 4 },
          },
          {
            path: 'featuredFirst',
            label: 'Primeiro post em destaque',
            control: { kind: 'toggle' },
          },
          {
            path: 'aspectRatio',
            label: 'Proporção da capa',
            control: {
              kind: 'select',
              options: ASPECT_RATIOS.map((value) => ({
                value,
                label: ASPECT_RATIO_LABELS[value] ?? value,
              })),
            },
          },
          {
            path: 'titleLevel',
            label: 'Nível do título (SEO)',
            control: {
              kind: 'segmented',
              options: [
                { value: 'h2', label: 'H2' },
                { value: 'h3', label: 'H3' },
                { value: 'h4', label: 'H4' },
              ],
            },
          },
          {
            path: 'gap',
            label: 'Espaço entre posts',
            responsive: true,
            control: { kind: 'number', min: 0, max: 400, unit: 'px' },
          },
        ],
      },
      { id: 'card', label: 'Cartão', tab: 'style', fields: cardStyleFields },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SitePostListProps>) => {
      const p = node.props
      const list = ctx.cms?.lists?.[node.id] ?? ctx.cms?.postList?.(node.id, p)
      const archive = p.showArchiveHeader ? ctx.cms?.archive : undefined
      const posts = list?.posts ?? []
      const header = archive ? (
        <header className='s-plist-head'>
          <h1 className='s-t-h2'>{archive.title}</h1>
          {archive.description ? <p>{archive.description}</p> : null}
        </header>
      ) : null
      const body =
        posts.length === 0 ? (
          editing && !ctx.cms?.sample ? (
            <Placeholder label='Os posts publicados do blog aparecem aqui' />
          ) : p.emptyText ? (
            <p className='s-plist-empty'>{p.emptyText}</p>
          ) : null
        ) : (
          <ul className='s-plist-items'>
            {posts.map((post, index) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  p={p}
                  lead={p.featuredFirst && index === 0 && list?.page === 1}
                />
              </li>
            ))}
          </ul>
        )
      if (!header && !body) return null
      return (
        <div
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-plist', `s-plist-${p.layout}`)}
        >
          {header}
          {body}
          {p.pagination && list ? <Pager list={list} /> : null}
        </div>
      )
    },
  })
}

// ─── post ─────────────────────────────────────────────────────────────────

function Faq({ faq }: { faq: Array<{ question: string; answer: string }> }) {
  if (faq.length === 0) return null
  return (
    <section className='s-post-faq' aria-labelledby='s-post-faq-title'>
      <h2 id='s-post-faq-title'>Perguntas frequentes</h2>
      {faq.map((item) => (
        <details key={item.question}>
          <summary>{item.question}</summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </section>
  )
}

export function postDefinition(ctx: SiteRenderContext) {
  return defineComponent<SitePostProps>({
    type: SITE_TYPES.post,
    label: 'Post',
    icon: 'post',
    category: 'Blog',
    keywords: ['artigo', 'conteúdo do post', 'blog', 'texto do post'],
    propsSchema: sitePostSchema,
    defaultProps: () => ({
      showTitle: true,
      showMeta: true,
      showCover: true,
      showExcerpt: true,
      showTags: true,
      showFaq: true,
      showUpdated: true,
      maxWidth: { value: 760, unit: 'px' },
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Mostrar',
        tab: 'content',
        fields: [
          { path: 'showTitle', label: 'Título', control: { kind: 'toggle' } },
          {
            path: 'showMeta',
            label: 'Data, autor e tempo de leitura',
            control: { kind: 'toggle' },
          },
          {
            path: 'showUpdated',
            label: 'Data de atualização',
            control: { kind: 'toggle' },
          },
          { path: 'showCover', label: 'Capa', control: { kind: 'toggle' } },
          {
            path: 'showExcerpt',
            label: 'Resumo como abertura',
            control: { kind: 'toggle' },
          },
          { path: 'showTags', label: 'Tags', control: { kind: 'toggle' } },
          {
            path: 'showFaq',
            label: 'Perguntas frequentes do post',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Texto',
        tab: 'style',
        fields: [
          {
            path: 'maxWidth',
            label: 'Largura máxima do texto',
            responsive: true,
            control: { kind: 'size', units: ['px', '%', 'fill'] },
          },
          {
            path: 'align',
            label: 'Posição',
            responsive: true,
            control: { kind: 'segmented', options: ALIGN_OPTIONS },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SitePostProps>) => {
      const p = node.props
      const post = ctx.cms?.post
      if (!post) {
        return editing ? (
          <div {...attributes} className={classNames(node, 's-post')}>
            <Placeholder label='O conteúdo do post aparece aqui (título, capa e texto)' />
          </div>
        ) : null
      }
      const cover = p.showCover
        ? safeSrc(post.coverUrl ?? undefined)
        : undefined
      const updated =
        p.showUpdated &&
        post.updatedLabel &&
        post.updatedLabel !== post.dateLabel
      return (
        <article
          {...attributes}
          id={anchorId(p.anchor)}
          className={classNames(node, 's-post')}
        >
          <header className='s-post-head'>
            {p.showMeta ? <TermChips terms={post.categories} /> : null}
            {p.showTitle ? <h1 className='s-t-h1'>{post.title}</h1> : null}
            {p.showExcerpt && post.excerpt ? (
              <p className='s-post-lead s-t-lead'>{post.excerpt}</p>
            ) : null}
            {p.showMeta ? (
              <p className='s-pmeta'>
                {post.author ? (
                  <span>
                    por <a href={post.author.href}>{post.author.name}</a>
                  </span>
                ) : null}
                <time dateTime={post.publishedAt}>{post.dateLabel}</time>
                <span>{readingLabel(post.readingMinutes)}</span>
                {updated ? (
                  <span>
                    Atualizado em{' '}
                    <time dateTime={post.updatedAt}>{post.updatedLabel}</time>
                  </span>
                ) : null}
              </p>
            ) : null}
          </header>
          {cover ? (
            <figure className='s-post-cover'>
              <img
                src={cover}
                alt={post.coverAlt ?? ''}
                decoding='async'
                fetchPriority='high'
              />
            </figure>
          ) : null}
          <div
            className='s-post-body'
            // Built by `plateToHtml`: allowlisted nodes, escaped text and
            // checked URLs only.
            dangerouslySetInnerHTML={{ __html: post.html }}
          />
          {p.showFaq ? <Faq faq={post.faq} /> : null}
          {p.showTags ? (
            <footer className='s-post-foot'>
              <TermChips terms={post.tags} className='s-ptags' />
            </footer>
          ) : null}
        </article>
      )
    },
  })
}

// ─── categories / tags ────────────────────────────────────────────────────

export function postTermsDefinition(ctx: SiteRenderContext) {
  return defineComponent<SitePostTermsProps>({
    type: SITE_TYPES.postTerms,
    label: 'Categorias e tags',
    icon: 'postTerms',
    category: 'Blog',
    keywords: ['categorias', 'tags', 'assuntos', 'temas', 'blog'],
    propsSchema: sitePostTermsSchema,
    defaultProps: () => ({
      taxonomy: 'categories',
      scope: 'all',
      display: 'list',
      showCount: true,
      title: 'Categorias',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Termos',
        tab: 'content',
        fields: [
          {
            path: 'taxonomy',
            label: 'Mostrar',
            control: {
              kind: 'segmented',
              options: [
                { value: 'categories', label: 'Categorias' },
                { value: 'tags', label: 'Tags' },
              ],
            },
          },
          {
            path: 'scope',
            label: 'Quais',
            control: {
              kind: 'segmented',
              options: [
                { value: 'all', label: 'Todas do blog' },
                { value: 'post', label: 'Do post atual' },
              ],
            },
          },
          {
            path: 'title',
            label: 'Título',
            control: { kind: 'text', maxLength: 120 },
          },
          {
            path: 'showCount',
            label: 'Quantidade de posts',
            showIf: { path: 'scope', equals: 'all' },
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Exibição',
        tab: 'style',
        fields: [
          {
            path: 'display',
            label: 'Estilo',
            control: {
              kind: 'segmented',
              options: [
                { value: 'list', label: 'Lista' },
                { value: 'chips', label: 'Etiquetas' },
              ],
            },
          },
          {
            path: 'gap',
            label: 'Espaço entre itens',
            responsive: true,
            control: { kind: 'number', min: 0, max: 400, unit: 'px' },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SitePostTermsProps>) => {
      const p = node.props
      const cms = ctx.cms
      const terms =
        p.scope === 'post'
          ? ((p.taxonomy === 'categories'
              ? cms?.post?.categories
              : cms?.post?.tags) ?? [])
          : ((p.taxonomy === 'categories' ? cms?.categories : cms?.tags) ?? [])
      if (terms.length === 0) {
        return editing ? (
          <div {...attributes}>
            <Placeholder
              label={
                p.taxonomy === 'categories'
                  ? 'As categorias do blog aparecem aqui'
                  : 'As tags do blog aparecem aqui'
              }
            />
          </div>
        ) : null
      }
      return (
        <nav
          {...attributes}
          id={anchorId(p.anchor)}
          aria-label={
            p.title || (p.taxonomy === 'categories' ? 'Categorias' : 'Tags')
          }
          className={classNames(node, 's-pterms', `s-pterms-${p.display}`)}
        >
          {p.title ? <p className='s-pterms-title'>{p.title}</p> : null}
          <ul>
            {terms.map((term) => (
              <li key={term.id}>
                <a href={term.href}>
                  {term.name}
                  {p.showCount &&
                  p.scope === 'all' &&
                  term.count !== undefined ? (
                    <span className='s-pterms-count'> ({term.count})</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )
    },
  })
}

// ─── blog search ──────────────────────────────────────────────────────────

export function blogSearchDefinition(ctx: SiteRenderContext) {
  return defineComponent<SiteBlogSearchProps>({
    type: SITE_TYPES.blogSearch,
    label: 'Busca do blog',
    icon: 'blogSearch',
    category: 'Blog',
    keywords: ['buscar', 'pesquisa', 'procurar', 'blog'],
    propsSchema: siteBlogSearchSchema,
    defaultProps: () => ({
      label: 'Buscar no blog',
      placeholder: 'O que você procura?',
      buttonLabel: 'Buscar',
      maxWidth: { value: 480, unit: 'px' },
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Busca',
        tab: 'content',
        fields: [
          {
            path: 'label',
            label: 'Rótulo (leitores de tela)',
            control: { kind: 'text', maxLength: 80 },
          },
          {
            path: 'placeholder',
            label: 'Texto de exemplo',
            control: { kind: 'text', maxLength: 120 },
          },
          {
            path: 'buttonLabel',
            label: 'Botão',
            control: { kind: 'text', maxLength: 40 },
          },
        ],
      },
      {
        id: 'style',
        label: 'Tamanho',
        tab: 'style',
        fields: [
          {
            path: 'maxWidth',
            label: 'Largura máxima',
            responsive: true,
            control: { kind: 'size', units: ['px', '%', 'fill'] },
          },
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({ node, attributes }: CanvasRenderProps<SiteBlogSearchProps>) => {
      const p = node.props
      const action = safeHref(ctx.cms?.blogHref) ?? '/blog'
      const inputId = `s-bs-${node.id}`
      return (
        <form
          {...attributes}
          id={anchorId(p.anchor)}
          aria-label={p.label || 'Buscar no blog'}
          method='get'
          action={action}
          className={classNames(node, 's-bsearch')}
        >
          <label htmlFor={inputId} className='s-sr'>
            {p.label || 'Buscar no blog'}
          </label>
          <input
            id={inputId}
            className='s-input'
            type='search'
            name='busca'
            placeholder={p.placeholder}
            defaultValue={ctx.cms?.query ?? ''}
            maxLength={100}
          />
          <button type='submit' className='s-btn s-btn-primary'>
            {p.buttonLabel || 'Buscar'}
          </button>
        </form>
      )
    },
  })
}

// ─── author ───────────────────────────────────────────────────────────────

function AuthorLinks({ author }: { author: SiteCmsAuthor }) {
  const links = (author.links ?? [])
    .map((link) => ({ ...link, href: safeHref(link.url) }))
    .filter((link) => link.href)
  if (links.length === 0) return null
  return (
    <ul className='s-social s-author-links'>
      {links.map((link) => {
        const network = Object.hasOwn(SOCIAL_NETWORKS, link.network)
          ? SOCIAL_NETWORKS[link.network as SocialNetwork]
          : null
        return (
          <li key={link.url}>
            <a href={link.href} target='_blank' rel='noopener noreferrer me'>
              {network ? (
                <IconSvg icon={network.svg} label={network.label} />
              ) : (
                link.url.replace(/^https?:\/\//, '')
              )}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export function postAuthorDefinition(ctx: SiteRenderContext) {
  return defineComponent<SitePostAuthorProps>({
    type: SITE_TYPES.postAuthor,
    label: 'Autor',
    icon: 'postAuthor',
    category: 'Blog',
    keywords: ['autor', 'perfil', 'bio', 'quem escreveu', 'blog'],
    propsSchema: sitePostAuthorSchema,
    defaultProps: () => ({
      showAvatar: true,
      showBio: true,
      showLinks: true,
      linkName: true,
      layout: 'row',
    }),
    accepts: false,
    inspector: [
      {
        id: 'content',
        label: 'Autor',
        tab: 'content',
        fields: [
          { path: 'showAvatar', label: 'Foto', control: { kind: 'toggle' } },
          { path: 'showBio', label: 'Biografia', control: { kind: 'toggle' } },
          {
            path: 'showLinks',
            label: 'Redes sociais',
            control: { kind: 'toggle' },
          },
          {
            path: 'linkName',
            label: 'Nome leva à página do autor',
            control: { kind: 'toggle' },
          },
        ],
      },
      {
        id: 'style',
        label: 'Layout',
        tab: 'style',
        fields: [
          {
            path: 'layout',
            label: 'Disposição',
            control: {
              kind: 'segmented',
              options: [
                { value: 'row', label: 'Lado a lado' },
                { value: 'column', label: 'Empilhado' },
              ],
            },
          },
          ...cardStyleFields,
        ],
      },
      spacingSection(),
      advancedSection,
    ],
    render: ({
      node,
      attributes,
      editing,
    }: CanvasRenderProps<SitePostAuthorProps>) => {
      const p = node.props
      // The author page shows its author; a post page, the post's.
      const author = ctx.cms?.author ?? ctx.cms?.post?.author ?? null
      if (!author) {
        return editing ? (
          <div {...attributes}>
            <Placeholder label='O autor do post aparece aqui' />
          </div>
        ) : null
      }
      const avatar = p.showAvatar
        ? safeSrc(author.avatarUrl ?? undefined)
        : undefined
      return (
        <aside
          {...attributes}
          id={anchorId(p.anchor)}
          aria-label='Sobre o autor'
          className={classNames(node, 's-author', `s-author-${p.layout}`)}
        >
          {avatar ? (
            <img
              className='s-author-photo'
              src={avatar}
              alt=''
              width={72}
              height={72}
              loading='lazy'
              decoding='async'
            />
          ) : null}
          <div className='s-author-body'>
            <p className='s-author-name'>
              {p.linkName ? (
                <a href={author.href} rel='author'>
                  {author.name}
                </a>
              ) : (
                author.name
              )}
            </p>
            {p.showBio && author.bio ? (
              <p className='s-author-bio'>{author.bio}</p>
            ) : null}
            {p.showLinks ? <AuthorLinks author={author} /> : null}
          </div>
        </aside>
      )
    },
  })
}
