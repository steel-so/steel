import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  renderSite,
  renderSiteEditing,
  siteDoc,
} from '@/src/__tests__/helpers/site-canvas'
import { spacing } from '@/src/lib/canvas/values'
import { menuEntries } from '@/src/lib/canvas-site/components/navigation'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import { siteLink } from '@/src/lib/canvas-site/context'
import { IconSvg, SITE_ICONS } from '@/src/lib/canvas-site/icons'
import {
  anchor,
  box,
  button,
  divider,
  form,
  heading,
  icon,
  image,
  list,
  menu,
  section,
  social,
  spacer,
  spec,
  text,
  toDocument,
  url,
  video,
} from '@/src/lib/canvas-site/presets/builder'
import {
  documentTypes,
  needsFormScript,
  SiteDocument,
} from '@/src/lib/canvas-site/render'

const out = (...nodes: Parameters<typeof siteDoc>[0]) =>
  renderSite(siteDoc(nodes))
const edit = (...nodes: Parameters<typeof siteDoc>[0]) =>
  renderSiteEditing(siteDoc(nodes))

describe('document output', () => {
  it('renders semantic html without editor markup', () => {
    const html = out(heading('h1', 'Olá'), text('Texto'))
    expect(html).toMatch(
      /^<div class="s-site"><main class="s-page s-[0-9a-z]+"><section class="s-section s-[0-9a-z]+"><div class="s-inner"><h1 class="s-t-h1 s-[0-9a-z]+">Olá<\/h1>/,
    )
    expect(html).not.toContain('data-canvas-id')
    expect(html).not.toContain('style=')
    expect(html).not.toContain('s-empty')
  })

  it('marks every node with attributes and hints in the editor', () => {
    const html = renderSiteEditing(
      toDocument([section({}, []), section({ tag: 'footer' }, [box({}, [])])]),
    )
    expect(html).toContain('class="s-site s-editing"')
    expect(html).toContain('data-canvas-id="root"')
    expect(html).toContain('Arraste elementos para esta seção')
    expect(html).toContain('Arraste elementos para cá')
    expect(html).toContain('<footer data-canvas-id=')
    expect(renderSiteEditing(toDocument([]))).toContain('Arraste uma Seção')
  })

  it('drops hidden and unknown nodes from the output', () => {
    const doc = siteDoc([heading('h2', 'Some'), heading('h2', 'Fica')])
    const [sectionId] = doc.nodes.root.children as string[]
    const [first] = doc.nodes[sectionId].children as string[]
    doc.nodes[first] = { ...doc.nodes[first], meta: { hidden: true } }
    doc.nodes.x = { id: 'x', type: 'site.nope', props: {} }
    doc.nodes[sectionId] = {
      ...doc.nodes[sectionId],
      children: [
        first,
        'x',
        'missing',
        ...(doc.nodes[sectionId].children as string[]).slice(1),
      ],
    }
    const html = renderSite(doc)
    expect(html).not.toContain('Some')
    expect(html).toContain('Fica')
    expect(renderSiteEditing(doc)).not.toContain('Some')
  })

  it('renders globals with a neutral root and lists the types', () => {
    const doc = toDocument([section({ tag: 'header' }, [menu()])], {
      tag: 'div',
    })
    expect(
      renderToStaticMarkup(createElement(SiteDocument, { doc })),
    ).toContain('<div class="s-page')
    expect([...documentTypes([doc])]).toEqual(
      expect.arrayContaining([
        SITE_TYPES.page,
        SITE_TYPES.section,
        SITE_TYPES.menu,
      ]),
    )
    expect(needsFormScript([doc])).toBe(false)
    const hidden = siteDoc([form({ formToken: 'abc' })])
    expect(needsFormScript([hidden])).toBe(true)
    const [sectionId] = hidden.nodes.root.children as string[]
    hidden.nodes[sectionId] = {
      ...hidden.nodes[sectionId],
      meta: { hidden: true },
    }
    expect(needsFormScript([hidden])).toBe(false)
  })
})

describe('layout', () => {
  it('renders section anchors, background video and container tags', () => {
    const html = out(
      box({ tag: 'article', anchor: 'card' }, [heading('h3', 'x')]),
    )
    expect(html).toContain('<article id="card" class="s-container')
    const withVideo = renderSite(
      toDocument([
        section(
          { anchor: 'topo', video: { src: '/v.mp4', poster: '/p.jpg' } },
          [],
        ),
      ]),
    )
    expect(withVideo).toContain('id="topo"')
    expect(withVideo).toContain(
      '<video class="s-bg-video" src="/v.mp4" poster="/p.jpg" autoPlay="" muted="" loop="" playsInline="" preload="metadata" tabindex="-1">',
    )
    const editingVideo = renderSiteEditing(
      toDocument([section({ video: { src: 'javascript:x' } }, [])]),
    )
    expect(editingVideo).not.toContain('<video')
  })

  it('renders the columns palette entry as nothing in the output', () => {
    const doc = siteDoc([spec(SITE_TYPES.columns)])
    expect(renderSite(doc)).not.toContain('s-columns')
    expect(renderSiteEditing(doc)).toMatch(/<div data-canvas-id="n\d+"><\/div>/)
  })
})

describe('text elements', () => {
  it('renders headings with presets and links', () => {
    expect(
      out(
        heading('h2', 'Título', { preset: 'h1', link: url('https://a.com') }),
      ),
    ).toContain('<h2 class="s-t-h1 s-')
    expect(
      out(
        heading('h2', 'T', {
          link: { type: 'url', value: 'https://a.com', newTab: true },
        }),
      ),
    ).toContain(
      '<a href="https://a.com" target="_blank" rel="noopener noreferrer">T</a>',
    )
    expect(
      out(
        heading('h3', 'T', { link: url('javascript:alert(1)'), anchor: 'x' }),
      ),
    ).toContain('<h3 id="x" class="s-t-h3 s-')
  })

  it('sanitizes rich text', () => {
    const html = out(
      text('<p onclick="x">Oi<script>alert(1)</script></p>', {
        preset: 'lead',
      }),
    )
    expect(html).toContain('<div class="s-rich s-t-lead s-')
    expect(html).toContain('<p>Oi</p>')
    expect(html).not.toContain('script')
  })

  it('renders buttons with variants, sizes and icons', () => {
    const html = out(
      button('Ir', anchor('contato'), { size: 'lg', icon: 'arrow' }),
      button('Antes', url('/a'), {
        variant: 'outline',
        size: 'sm',
        icon: 'play',
        iconPosition: 'start',
      }),
      button('Sem link', url(''), { size: 'md' }),
    )
    expect(html).toContain(
      '<a href="#contato" class="s-btn s-btn-primary s-btn-lg"><span>Ir</span><svg',
    )
    expect(html).toContain('class="s-btn s-btn-outline s-btn-sm"><svg')
    expect(html).toContain(
      '<span class="s-btn s-btn-primary"><span>Sem link</span></span>',
    )
  })

  it('renders lists with every marker', () => {
    const items = ['Um', 'Dois']
    expect(out(list(items, { marker: 'number' }))).toMatch(
      /<ol class="s-list s-list-number s-t-body s-[0-9a-z]+"><li><span>Um<\/span>/,
    )
    expect(out(list(items, { marker: 'check' }))).toContain(
      '<span class="s-marker"><svg',
    )
    const icons = out(
      spec(SITE_TYPES.list, {
        marker: 'icon',
        icon: 'star',
        items: [
          { text: 'a', icon: 'rocket' },
          { text: 'b', icon: '' },
        ],
      }),
    )
    expect(icons.match(/s-marker/g)).toHaveLength(2)
    expect(out(list(items, { marker: 'dot' }))).not.toContain('s-marker')
    expect(out(list(items, { marker: 'none', anchor: 'l' }))).toContain(
      '<ul id="l"',
    )
  })

  it('renders dividers and spacers', () => {
    expect(out(divider({ anchor: 'd' }))).toMatch(
      /<hr id="d" class="s-divider s-[0-9a-z]+"\/>/,
    )
    expect(out(spacer(40))).toMatch(
      /<div aria-hidden="true" class="s-spacer s-[0-9a-z]+"><\/div>/,
    )
  })
})

describe('media', () => {
  it('renders images with dimensions, priority, links and captions', () => {
    const html = out(
      image('/a.png', 'Foto', {
        dimensions: { width: 10, height: 20 },
        priority: true,
        caption: 'Legenda',
        anchor: 'img',
      }),
    )
    expect(html).toContain('<figure id="img" class="s-image')
    expect(html).toContain(
      '<img class="s-media" src="/a.png" alt="Foto" width="10" height="20" loading="eager" decoding="sync" fetchPriority="high"/>',
    )
    expect(html).toContain(
      '<figcaption class="s-caption s-t-small">Legenda</figcaption>',
    )
    const linked = out(image('/a.png', 'Foto', { link: url('/x') }))
    expect(linked).toContain(
      '<a href="/x" class="s-media"><img src="/a.png" alt="Foto" loading="lazy" decoding="async"/></a>',
    )
  })

  it('drops images without a safe source and shows a placeholder while editing', () => {
    expect(out(image('javascript:x', 'x'))).not.toContain('s-image')
    expect(edit(image('', ''))).toContain('Escolha uma imagem')
  })

  it('renders icons decorative or labelled, linked or not', () => {
    expect(out(icon('rocket'))).toContain(
      '<span class="s-icon-box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">',
    )
    expect(
      out(icon('star', { label: 'Nota', link: url('/n'), anchor: 'i' })),
    ).toContain(
      '<a href="/n" class="s-icon-box"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" role="img" aria-label="Nota">',
    )
    expect(
      renderToStaticMarkup(
        createElement(IconSvg, { icon: SITE_ICONS.check.svg, className: 'x' }),
      ),
    ).toContain('class="x"')
  })

  it('renders hosted and uploaded videos', () => {
    expect(
      out(video('https://youtu.be/dQw4w9WgXcQ', { title: 'Demo' })),
    ).toContain(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=0&amp;mute=0&amp;controls=1&amp;rel=0" title="Demo" loading="lazy"',
    )
    expect(
      out(video('https://vimeo.com/76979871', { source: 'vimeo', title: '' })),
    ).toContain('title="Vídeo"')
    expect(
      out(
        video('/v.mp4', {
          source: 'upload',
          poster: '/p.jpg',
          autoplay: true,
          anchor: 'v',
        }),
      ),
    ).toContain(
      '<video src="/v.mp4" poster="/p.jpg" title="Vídeo" controls="" autoPlay="" muted="" playsInline="" preload="auto">',
    )
    expect(out(video('/v.mp4', { source: 'upload' }))).toContain(
      'preload="none"',
    )
    expect(out(video('nope'))).not.toContain('s-video')
    expect(out(video('ftp://x', { source: 'upload' }))).not.toContain('s-video')
    expect(edit(video(''))).toContain('Cole o endereço')
    const editing = edit(video('dQw4w9WgXcQ', { autoplay: true }))
    expect(editing).toContain('autoplay=0')
    expect(editing).toContain('class="s-embed-preview"')
  })

  it('renders sandboxed embeds from https urls or html', () => {
    const embed = (props: Record<string, unknown>) =>
      spec(SITE_TYPES.embed, props)
    expect(
      out(embed({ mode: 'url', url: 'https://maps.example/x' })),
    ).toContain(
      '<iframe src="https://maps.example/x" title="Conteúdo incorporado" sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox" loading="lazy" referrerPolicy="no-referrer">',
    )
    expect(
      out(
        embed({ mode: 'html', html: '<b>x</b>', title: 'Widget', anchor: 'e' }),
      ),
    ).toContain('srcDoc="&lt;b&gt;x&lt;/b&gt;" title="Widget"')
    expect(out(embed({ mode: 'url', url: 'http://x.com' }))).not.toContain(
      's-embed',
    )
    expect(out(embed({ mode: 'html', html: '  ' }))).not.toContain('s-embed')
    expect(edit(embed({ mode: 'url', url: '' }))).toContain(
      'Informe um endereço',
    )
    expect(edit(embed({ mode: 'url', url: 'https://a.com' }))).toContain(
      's-embed-preview',
    )
  })
})

describe('navigation', () => {
  const pages = [
    { id: 'home', title: 'Início', path: '/' },
    { id: 'blog', title: 'Blog', path: '/blog' },
    { id: 'post', title: 'Post', path: '/blog/post', parentId: 'blog' },
    { id: 'off', title: 'Oculta', path: '/oculta', showInMenu: false },
  ]

  it('lists the site pages with the current one marked', () => {
    const html = renderSite(siteDoc([menu()]), { pages, currentPageId: 'blog' })
    expect(html).toContain(
      '<nav aria-label="Menu principal" class="s-menu s-menu-collapse-tablet',
    )
    expect(html).toContain(
      '<a class="s-menu-link" href="/blog" aria-current="page">Blog</a>',
    )
    expect(html).not.toContain('Post')
    expect(html).not.toContain('Oculta')
    expect(html).toContain(
      '<details class="s-menu-burger"><summary aria-label="Abrir menu">',
    )
  })

  it('resolves page links through the context', () => {
    const ctx = {
      pages,
      pageHref: (id: string) => (id === 'home' ? '/s/demo' : undefined),
    }
    expect(siteLink({ type: 'page', value: 'home' }, ctx)).toEqual({
      href: '/s/demo',
    })
    expect(siteLink({ type: 'page', value: 'blog' }, ctx)).toEqual({
      href: '/blog',
    })
    expect(siteLink({ type: 'page', value: 'gone' }, {})).toEqual({ href: '#' })
    expect(siteLink(undefined, {})).toEqual({})
  })

  it('renders custom items, no hamburger and nothing when empty', () => {
    const html = out(
      menu({
        source: 'custom',
        collapse: 'never',
        label: '',
        orientation: 'vertical',
        anchor: 'm',
        items: [
          {
            label: 'Externo',
            link: { type: 'url', value: 'https://a.com', newTab: true },
          },
        ],
      }),
    )
    expect(html).toContain('<nav id="m" aria-label="Menu"')
    expect(html).toContain('target="_blank" rel="noopener noreferrer"')
    expect(html).not.toContain('s-menu-burger')
    expect(out(menu())).not.toContain('<nav')
    expect(edit(menu())).toContain('Serviços')
    expect(menuEntries({ source: 'pages' } as never, {}, false)).toEqual([])
  })

  it('renders social links and skips unsafe urls in the output', () => {
    const html = out(social(['instagram', 'x']))
    expect(html).toContain(
      '<a href="https://instagram.com/" target="_blank" rel="noopener noreferrer" aria-label="Instagram">',
    )
    expect(html).toContain('aria-label="X (Twitter)"')
    const unsafe = siteDoc([
      spec(SITE_TYPES.social, {
        items: [{ network: 'github', url: 'javascript:x' }],
        anchor: 's',
      }),
    ])
    expect(renderSite(unsafe)).not.toContain('s-social')
    expect(renderSiteEditing(unsafe)).toContain('aria-label="GitHub"')
  })
})

describe('forms', () => {
  const fields = [
    {
      key: 'nome',
      label: 'Nome',
      type: 'text',
      required: true,
      placeholder: 'Seu nome',
    },
    { key: 'email', label: 'E-mail', type: 'email', required: true },
    { key: 'fone', label: 'Telefone', type: 'phone', required: false },
    { key: 'msg', label: 'Mensagem', type: 'textarea', required: false },
    {
      key: 'plano',
      label: 'Plano',
      type: 'select',
      required: false,
      options: [{ label: 'Pro', value: 'pro' }],
    },
    {
      key: 'tipo',
      label: 'Tipo',
      type: 'select',
      required: false,
      placeholder: 'Escolha',
    },
    { key: 'aceite', label: 'Aceito', type: 'checkbox', required: true },
  ]

  it('renders the snapshot fields and posts to the CRM endpoint', () => {
    const html = out(form({ formToken: 'tok_1', fields, anchor: 'f' }))
    expect(html).toContain('<form id="f" class="s-form s-')
    expect(html).toContain(
      'data-site-form="" data-success="Recebemos suas informações. Em breve entraremos em contato." action="/api/crm/forms/tok_1/submit" method="post"',
    )
    expect(html).toMatch(
      /<label class="s-label" for="n\d+-nome">Nome<span aria-hidden="true"> \*<\/span><\/label>/,
    )
    expect(html).toMatch(
      /<input id="n\d+-nome" required="" data-field="" class="s-input" type="text" placeholder="Seu nome" name="nome"\/>/,
    )
    expect(html).toContain('type="email" autoComplete="email"')
    expect(html).toContain('type="tel" autoComplete="tel"')
    expect(html).toContain(
      '<div class="s-field s-field-wide"><label class="s-label"',
    )
    expect(html).toContain(
      'selected="">Selecione</option><option value="pro">Pro</option>',
    )
    expect(html).toContain('selected="">Escolha</option></select>')
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*value="true"/)
    expect(html).toContain(
      'tabindex="-1" autoComplete="off" name="company_website"',
    )
    expect(html).toContain(
      '<button type="submit" class="s-btn s-btn-primary">Enviar</button>',
    )
  })

  it('prefers the live form and a custom action', () => {
    const html = renderSite(
      siteDoc([form({ formToken: 'tok', fields, submitLabel: '' })]),
      {
        forms: {
          tok: {
            fields: [
              { key: 'x', label: 'Só este', type: 'text', required: false },
            ],
            successMessage: 'Valeu!',
            redirectUrl: '/obrigado',
          },
        },
        formAction: (token) => `/s/demo/forms/${token}`,
      },
    )
    expect(html).toContain('action="/s/demo/forms/tok"')
    expect(html).toContain('data-success="Valeu!" data-redirect="/obrigado"')
    expect(html).toContain('Só este')
    expect(html).not.toContain('Aceito')
    const unsafe = renderSite(siteDoc([form({ formToken: 'tok' })]), {
      forms: {
        tok: { fields: [], redirectUrl: 'javascript:x', successMessage: null },
      },
    })
    expect(unsafe).not.toContain('data-redirect')
  })

  it('is absent without a form and shows a sample while editing', () => {
    expect(out(form())).not.toContain('<form')
    const editing = edit(form())
    expect(editing).toContain('Exemplo: escolha um formulário do CRM')
    expect(editing).toContain('disabled=""')
    expect(editing).not.toContain('action=')
  })
})

describe('spacing helpers in output', () => {
  it('keeps margin declarations in classes, never inline', () => {
    const html = out(heading('h2', 'x', { margin: spacing(8) }))
    expect(html).not.toContain('style=')
  })
})
