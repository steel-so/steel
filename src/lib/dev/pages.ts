import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import { cache } from 'react'
import {
  DEV_SECTIONS,
  devSectionLabel,
  devSectionRank,
} from '@/src/lib/dev/sections'
import type { DocsSearchable } from '@/src/lib/docs/search'
import { extractHeadings, type MdxHeading } from '@/src/lib/mdx/headings'
import {
  DevPageFrontmatterSchema,
  type DevSectionSlug,
  devPagePath,
} from '@/src/schemas/dev-page.schema'

/**
 * The developer guides. Each page is an MDX file at `content/dev/<path>.mdx`
 * (one folder level at most), served at `/dev/<path>`. The landing (`/dev`)
 * and the API reference (`/dev/api`) are routes of their own and are added
 * to the sidebar and the search here. A malformed file throws, so a bad
 * page fails the build instead of shipping.
 */
export const DEV_ROOT = '/dev'
export const DEV_API_HREF = '/dev/api'
/** Reference of the public API v1 (`public/openapi.v1.json`). */
export const DEV_API_V1_HREF = '/dev/api/v1'

export interface DevPageMeta {
  section: DevSectionSlug
  /** Path relative to `content/dev`, without `.mdx` (`guias/criar-lead`). */
  slug: string
  href: string
  title: string
  description: string
  order: number
}

export interface DevPage extends DevPageMeta {
  source: string
  headings: MdxHeading[]
}

export interface DevNavSection {
  slug: string
  label: string
  pages: { href: string; title: string }[]
}

const devDir = () => path.join(process.cwd(), 'content', 'dev')

async function readDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** `.mdx` files under `content/dev`, as paths relative to it. */
async function listFiles(): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readDir(devDir())) {
    if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(entry.name)
    } else if (entry.isDirectory()) {
      for (const child of await readDir(path.join(devDir(), entry.name))) {
        if (child.isFile() && child.name.endsWith('.mdx')) {
          files.push(`${entry.name}/${child.name}`)
        }
      }
    }
  }
  return files
}

async function readPage(file: string): Promise<DevPage> {
  const where = `content/dev/${file}`
  const slug = file.replace(/\.mdx$/, '')
  if (!devPagePath.safeParse(slug).success) {
    throw new Error(`Invalid dev page path: ${where}`)
  }

  const raw = await fs.readFile(path.join(devDir(), file), 'utf-8')
  const { data, content } = matter(raw)
  const parsed = DevPageFrontmatterSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`Invalid frontmatter in ${where}: ${parsed.error.message}`)
  }

  const source = content.trim()
  return {
    ...parsed.data,
    slug,
    href: `${DEV_ROOT}/${slug}`,
    source,
    headings: extractHeadings(source),
  }
}

function comparePages(a: DevPage, b: DevPage): number {
  return (
    devSectionRank(a.section) - devSectionRank(b.section) ||
    a.order - b.order ||
    a.title.localeCompare(b.title, 'pt-BR')
  )
}

/** Every guide, in reading order (sidebar group, then `order`, then title). */
export const getAllDevPages = cache(async (): Promise<DevPage[]> => {
  const files = await listFiles()
  const pages = await Promise.all(files.map(readPage))
  return pages.sort(comparePages)
})

export const getAllDevPagesMeta = cache(
  async (): Promise<DevPageMeta[]> =>
    (await getAllDevPages()).map(
      ({ source: _source, headings: _headings, ...meta }) => meta,
    ),
)

/** The page at `/dev/<segments...>`, or `null`. */
export const getDevPageByPath = cache(
  async (segments: string[]): Promise<DevPage | null> => {
    const href = `${DEV_ROOT}/${segments.join('/')}`
    return (await getAllDevPages()).find((page) => page.href === href) ?? null
  },
)

/**
 * Sidebar: the groups that have pages, then "Referência" with the API
 * reference (a route, not a guide).
 */
export const getDevNav = cache(async (): Promise<DevNavSection[]> => {
  const pages = await getAllDevPages()
  const groups = DEV_SECTIONS.map((section) => ({
    slug: section.slug,
    label: section.label,
    pages: pages
      .filter((page) => page.section === section.slug)
      .map(({ href, title }) => ({ href, title })),
  })).filter((section) => section.pages.length > 0)
  return [
    ...groups,
    {
      slug: 'referencia',
      label: 'Referência',
      pages: [
        { href: DEV_API_HREF, title: 'Referência da API' },
        { href: DEV_API_V1_HREF, title: 'Referência da API v1' },
      ],
    },
  ]
})

/** Previous and next guide in reading order. */
export async function getAdjacentDevPages(href: string): Promise<{
  prev: DevPageMeta | null
  next: DevPageMeta | null
}> {
  const pages = await getAllDevPagesMeta()
  const index = pages.findIndex((page) => page.href === href)
  if (index === -1) return { prev: null, next: null }
  return {
    prev: pages[index - 1] ?? null,
    next: pages[index + 1] ?? null,
  }
}

/** Search entries: the guides plus the landing and the API reference. */
export const getDevSearchIndex = cache(async (): Promise<DocsSearchable[]> => {
  const pages = await getAllDevPages()
  return [
    {
      href: DEV_ROOT,
      title: 'Visão geral',
      description:
        'O que dá para integrar com o Steel, o endereço base da API e os ambientes.',
      section: 'Introdução',
      headings: [],
    },
    ...pages.map((page) => ({
      href: page.href,
      title: page.title,
      description: page.description,
      section: devSectionLabel(page.section),
      headings: page.headings.map(({ id, text }) => ({ id, text })),
    })),
    {
      href: DEV_API_HREF,
      title: 'Referência da API',
      description:
        'Todas as rotas, parâmetros, respostas e códigos de erro, geradas do código.',
      section: 'Referência',
      headings: [],
    },
    {
      href: DEV_API_V1_HREF,
      title: 'Referência da API v1',
      description:
        'A API pública e estável, com token pessoal: chamados, leads, oportunidades e WhatsApp.',
      section: 'Referência',
      headings: [],
    },
  ]
})
