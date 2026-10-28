import { RssIcon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import type { PublicNewsletterArchivePageDTO } from '@/src/schemas/crm-newsletter-archive.schema'

/** Dates of the archive: always in America/Sao_Paulo (CI runs in UTC). */
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'long',
  timeZone: 'America/Sao_Paulo',
})

export function formatIssueDate(iso: string): string {
  return dateFormatter.format(new Date(iso))
}

/** Only a plain hex color of the e-mail brand reaches the style. */
function brandStyle(color: string | null): CSSProperties | undefined {
  if (!color || !/^#[0-9a-f]{3,8}$/i.test(color)) return undefined
  return { '--newsletter-brand': color } as CSSProperties
}

/**
 * Frame of every archive page: brand bar, logo, newsletter name and a
 * "Publicado com Steel" footer. The brand color only tints accents; text
 * stays on semantic tokens so light and dark both read well.
 */
export function NewsletterArchiveShell({
  archive,
  children,
  headingLevel = 'h1',
  archiveHref,
  rssHref,
}: {
  archive: Pick<PublicNewsletterArchivePageDTO, 'workspaceName' | 'newsletter'>
  children: ReactNode
  /** `h1` on the archive home; on an issue page the subject is the h1. */
  headingLevel?: 'h1' | 'p'
  archiveHref: string
  rssHref: string
}) {
  const { newsletter, workspaceName } = archive
  const Heading = headingLevel
  return (
    <div
      className='flex min-h-screen flex-col bg-background text-foreground'
      style={brandStyle(newsletter.primaryColor)}
    >
      <div
        aria-hidden='true'
        className='h-1.5 w-full bg-[var(--newsletter-brand,var(--primary))]'
      />
      <header className='border-border border-b'>
        <div className='mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4 sm:px-6'>
          <Link
            href={archiveHref}
            className='flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            {newsletter.logoUrl ? (
              <img
                src={newsletter.logoUrl}
                alt=''
                className='size-10 shrink-0 rounded-lg border bg-white object-contain p-1'
              />
            ) : (
              <span
                aria-hidden='true'
                className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--newsletter-brand,var(--primary))] font-semibold text-lg text-primary-foreground'
              >
                {newsletter.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <span className='min-w-0'>
              <Heading className='truncate font-semibold text-base leading-tight'>
                {newsletter.name}
              </Heading>
              <span className='block truncate text-muted-foreground text-xs'>
                {workspaceName}
              </span>
            </span>
          </Link>
          <a
            href={rssHref}
            className='inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground text-xs hover:bg-muted hover:text-foreground'
          >
            <SteelIcon icon={RssIcon} size={14} />
            <span>RSS</span>
          </a>
        </div>
      </header>
      <main className='mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10'>
        {children}
      </main>
      <footer className='border-border border-t px-4 py-6 text-center text-muted-foreground text-xs'>
        Publicado com Steel
      </footer>
    </div>
  )
}
