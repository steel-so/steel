import { evaluate } from '@mdx-js/mdx'
import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import * as runtime from 'react/jsx-runtime'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className='not-prose my-6 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground [&_strong]:text-primary'>
      {children}
    </div>
  )
}

function Anchor({ href = '', ...props }: ComponentProps<'a'>) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return <Link href={href} {...props} />
  }
  return <a href={href} target='_blank' rel='noopener noreferrer' {...props} />
}

function Img({ alt = '', ...props }: ComponentProps<'img'>) {
  // Markdown images carry no intrinsic size, so next/image does not fit;
  // lazy loading keeps long entries cheap.
  return <img alt={alt} loading='lazy' decoding='async' {...props} />
}

const COMPONENTS: MDXComponents = { a: Anchor, img: Img, Callout }

/**
 * Compiles an entry's MDX on the server. Sources come from this repository
 * (`content/changelog`), never from users, so evaluating them is safe.
 */
export async function ChangelogMdx({ source }: { source: string }) {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  })

  return (
    <div className='prose prose-neutral dark:prose-invert max-w-none w-full prose-headings:scroll-mt-24 prose-headings:font-medium prose-a:text-primary prose-a:underline-offset-4 prose-img:rounded-2xl prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground'>
      <Content components={COMPONENTS} />
    </div>
  )
}
