import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { JsonLd } from '@/components/seo/json-ld'
import { buildMcpToolCatalog } from '@/src/lib/dev/mcp-tools'
import {
  getAdjacentDevPages,
  getAllDevPagesMeta,
  getDevPageByPath,
} from '@/src/lib/dev/pages'
import { devSectionLabel } from '@/src/lib/dev/sections'
import { SITE_URL } from '@/src/lib/seo/site'
import { DocsMdx } from '../../docs/_components/docs-mdx'
import { DocsPager } from '../../docs/_components/docs-pager'
import { DocsToc } from '../../docs/_components/docs-toc'
import { DEV_MDX_COMPONENTS } from '../_components/dev-mdx-components'
import { McpToolTable } from '../_components/mcp-tool-table'

/**
 * The MCP guide's tool table reads the Steel AI registry, which only the
 * server has; the page is static, so it's fixed at build time.
 */
const COMPONENTS = {
  ...DEV_MDX_COMPONENTS,
  McpToolTable: () => <McpToolTable catalog={buildMcpToolCatalog()} />,
}

interface Props {
  params: Promise<{ slug: string[] }>
}

export async function generateStaticParams() {
  const pages = await getAllDevPagesMeta()
  return pages.map((page) => ({ slug: page.slug.split('/') }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const page = await getDevPageByPath(slug)
  if (!page) return { title: 'Página não encontrada | Steel' }

  const title = `${page.title} | Desenvolvedores Steel`
  return {
    title,
    description: page.description,
    alternates: { canonical: page.href },
    openGraph: {
      type: 'article',
      url: page.href,
      title,
      description: page.description,
      section: devSectionLabel(page.section),
      images: ['/opengraph-image'],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.description,
      images: ['/twitter-image'],
    },
  }
}

export default async function DevGuidePage({ params }: Props) {
  const { slug } = await params
  const page = await getDevPageByPath(slug)
  if (!page) notFound()

  const { prev, next } = await getAdjacentDevPages(page.href)
  const sectionLabel = devSectionLabel(page.section)
  const pageUrl = `${SITE_URL}${page.href}`

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: page.title,
    description: page.description,
    articleSection: sectionLabel,
    inLanguage: 'pt-BR',
    url: pageUrl,
    proficiencyLevel: 'Expert',
    author: { '@type': 'Organization', name: 'Stratus Telecom' },
    publisher: {
      '@type': 'Organization',
      name: 'Steel',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/brand/logo.png` },
    },
    about: { '@type': 'WebAPI', name: 'API do Steel' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl },
  }

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { name: 'Desenvolvedores', item: `${SITE_URL}/dev` },
      { name: page.title, item: pageUrl },
    ].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      ...crumb,
    })),
  }

  return (
    <div className='flex w-full gap-10 py-10 lg:py-16 lg:pr-8'>
      <JsonLd data={articleSchema} />
      <JsonLd data={breadcrumbSchema} />
      <main className='flex min-w-0 max-w-3xl flex-1 flex-col gap-10'>
        <header className='flex flex-col gap-3'>
          <nav aria-label='Trilha' className='text-sm text-muted-foreground'>
            <Link href='/dev' className='hover:text-primary'>
              Desenvolvedores
            </Link>
            {' / '}
            <span>{sectionLabel}</span>
          </nav>
          <h1 className='text-3xl font-normal sm:text-4xl'>{page.title}</h1>
          <p className='text-lg text-muted-foreground'>{page.description}</p>
          {page.headings.length > 0 && (
            <details className='rounded-md border border-border p-3 xl:hidden'>
              <summary className='cursor-pointer text-sm font-medium'>
                Nesta página
              </summary>
              <div className='mt-3'>
                <DocsToc headings={page.headings} showTitle={false} />
              </div>
            </details>
          )}
        </header>
        <article className='min-w-0'>
          <DocsMdx source={page.source} components={COMPONENTS} />
        </article>
        <DocsPager prev={prev} next={next} />
      </main>
      <aside className='sticky top-24 hidden h-fit w-56 shrink-0 xl:block'>
        <DocsToc headings={page.headings} />
      </aside>
    </div>
  )
}
