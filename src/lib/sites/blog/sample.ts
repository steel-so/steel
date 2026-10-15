import type { BlogData, BlogPostBody, BlogPostRecord } from './resolve'

/**
 * Sample blog shown in the editor canvas while the site has no post yet,
 * so the blog templates and elements can be designed before writing.
 * Never reaches the public site.
 */

const COVER = '/landing-page-templates/agency'

const SAMPLE_TITLES = [
  'Como escolher o parceiro certo para o seu projeto',
  '5 erros comuns ao planejar a presença digital',
  'O que mudou no atendimento ao cliente este ano',
  'Guia rápido para medir resultados de marketing',
  'Bastidores: como trabalhamos do briefing à entrega',
  'Perguntas que todo cliente deveria fazer antes de contratar',
]

export function sampleBlogData(now: Date = new Date()): BlogData {
  const day = 24 * 60 * 60 * 1000
  const posts: BlogPostRecord[] = SAMPLE_TITLES.map((title, index) => ({
    id: `sample-${index + 1}`,
    title,
    slug: `exemplo-${index + 1}`,
    excerpt:
      'Este é um post de exemplo. Escreva seu primeiro post na aba Blog e ele aparece aqui no lugar deste.',
    coverImageUrl: `${COVER}/work-${(index % 4) + 1}.png`,
    coverImageAlt: '',
    publishedAt: new Date(now.getTime() - index * 3 * day).toISOString(),
    updatedAt: new Date(now.getTime() - index * 3 * day).toISOString(),
    readingMinutes: 3 + (index % 4),
    featured: index === 0,
    categoryIds: [index % 2 === 0 ? 'sample-cat-1' : 'sample-cat-2'],
    tagIds: ['sample-tag-1'],
    authorId: 'sample-author',
    searchText: title.toLowerCase(),
  }))
  return {
    posts,
    categories: [
      { id: 'sample-cat-1', name: 'Dicas', slug: 'dicas' },
      { id: 'sample-cat-2', name: 'Novidades', slug: 'novidades' },
    ],
    tags: [{ id: 'sample-tag-1', name: 'marketing', slug: 'marketing' }],
    authors: [
      {
        id: 'sample-author',
        name: 'Nome do autor',
        slug: 'autor-exemplo',
        bio: 'Uma linha sobre quem escreve: experiência, especialidade e o que compartilha no blog.',
        avatarUrl: `${COVER}/testimonial-avatar-1.png`,
        links: [],
      },
    ],
  }
}

export function samplePostBody(): BlogPostBody {
  return {
    html: '<p>Este é o texto de um post de exemplo. Quando você publicar um post, o conteúdo dele aparece aqui com títulos, imagens, listas, tabelas e destaques.</p><h2 id="um-subtitulo">Um subtítulo</h2><p>Os estilos do texto seguem o tema do site. Ajuste a largura e o que aparecer no painel à direita.</p><ul><li>Listas</li><li>Citações</li><li>Blocos de código</li></ul>',
    faq: [],
  }
}
