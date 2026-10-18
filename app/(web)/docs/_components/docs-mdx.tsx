import {
  Alert02Icon,
  InformationCircleIcon,
  UserShield01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { evaluate } from '@mdx-js/mdx'
import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import * as runtime from 'react/jsx-runtime'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { SteelIcon } from '@/components/icon/icon'
import { Kbd } from '@/components/ui/kbd'

const CALLOUTS = {
  nota: { icon: InformationCircleIcon, label: 'Nota' },
  admin: { icon: UserShield01Icon, label: 'Só administradores' },
  aviso: { icon: Alert02Icon, label: 'Atenção' },
} as const

type CalloutType = keyof typeof CALLOUTS

function Callout({
  type = 'nota',
  title,
  children,
}: {
  type?: CalloutType
  title?: string
  children: ReactNode
}) {
  const { icon, label } = CALLOUTS[type]
  return (
    <aside
      data-callout={type}
      className='not-prose my-6 flex gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline [&_strong]:text-primary'
    >
      <SteelIcon
        icon={icon}
        size={18}
        className='mt-0.5 shrink-0 text-primary'
      />
      <div className='flex min-w-0 flex-col gap-1'>
        <span className='font-medium text-primary'>{title ?? label}</span>
        <div className='[&>p]:m-0 [&>p+p]:mt-2'>{children}</div>
      </div>
    </aside>
  )
}

function Anchor({ href = '', ...props }: ComponentProps<'a'>) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return <Link href={href} {...props} />
  }
  return <a href={href} target='_blank' rel='noopener noreferrer' {...props} />
}

function Img({ alt = '', ...props }: ComponentProps<'img'>) {
  return <img alt={alt} loading='lazy' decoding='async' {...props} />
}

function Table(props: ComponentProps<'table'>) {
  // Wide tables scroll inside their own box instead of the page.
  return (
    <div className='relative my-6 w-full overflow-x-auto'>
      <table {...props} className='my-0' />
    </div>
  )
}

const COMPONENTS: MDXComponents = {
  a: Anchor,
  img: Img,
  table: Table,
  Callout,
  Kbd,
}

/**
 * Compiles a manual page on the server. Sources come from this repository
 * (`content/docs`, `content/dev`), never from users, so evaluating them is
 * safe. `components` adds page-specific blocks (the developer site's error
 * table) on top of the shared ones.
 */
export async function DocsMdx({
  source,
  components,
}: {
  source: string
  components?: MDXComponents
}) {
  const { default: Content } = await evaluate(source, {
    ...runtime,
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeSlug],
  })

  return (
    <div className='prose prose-neutral dark:prose-invert max-w-none w-full prose-headings:scroll-mt-24 prose-headings:font-medium prose-a:text-primary prose-a:underline-offset-4 prose-img:rounded-2xl prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground prose-code:before:content-none prose-code:after:content-none'>
      <Content components={{ ...COMPONENTS, ...components }} />
    </div>
  )
}
