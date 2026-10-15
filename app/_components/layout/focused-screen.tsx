import { ArrowLeft01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'

/**
 * Full-screen workspace for editors (site editor, e-mail editor): covers
 * the app chrome — global sidebar, header and the module's secondary nav —
 * so the canvas gets the whole window. Popovers, dialogs and toasts (z-50)
 * still open above it. Leave through the screen's own back button.
 */
export function FocusedScreen({
  label,
  mobileBack,
  children,
}: {
  /** Accessible name of the screen ("Editor do site"). */
  label: string
  /** Back link shown only below 1024 px, where editors replace their top
   * bar with a "use a larger screen" notice. */
  mobileBack?: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <section
      aria-label={label}
      data-testid='focused-screen'
      className='fixed inset-0 z-40 flex min-h-0 flex-col overflow-hidden bg-background text-foreground'
    >
      {mobileBack ? (
        <div className='flex h-12 shrink-0 items-center border-b px-3 lg:hidden'>
          <FocusedBackLink href={mobileBack.href} label={mobileBack.label} />
          <span className='truncate text-sm font-medium'>{label}</span>
        </div>
      ) : null}
      {children}
    </section>
  )
}

/** Back link of a focused screen (icon button with a tooltip label). */
export function FocusedBackLink({
  href,
  label,
}: {
  href: string
  label: string
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className='flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
    >
      <SteelIcon icon={ArrowLeft01Icon} className='size-4' />
    </Link>
  )
}

/** Simple top bar for focused screens without an editor top bar (galleries,
 * previews): back link, title and optional actions. */
export function FocusedHeader({
  backHref,
  backLabel,
  title,
  children,
}: {
  backHref: string
  backLabel: string
  title: ReactNode
  children?: ReactNode
}) {
  return (
    <header className='flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3'>
      <FocusedBackLink href={backHref} label={backLabel} />
      <h1 className='min-w-0 flex-1 truncate font-medium text-sm'>{title}</h1>
      {children}
    </header>
  )
}
