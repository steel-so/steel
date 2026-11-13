'use client'

import { Moon02Icon, Sun03Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

export type PreviewTheme = 'light' | 'dark'

/**
 * Claro / escuro toggle for previews. The labels are explicit so each
 * preview says what it shows: a real dark theme or a simulation of the
 * clients that force one (e-mail).
 */
export function ThemeSwitcher({
  value,
  onChange,
  lightLabel = 'Ver no modo claro',
  darkLabel = 'Ver no modo escuro',
  className,
}: {
  value: PreviewTheme
  onChange: (theme: PreviewTheme) => void
  lightLabel?: string
  darkLabel?: string
  className?: string
}) {
  const dark = value === 'dark'
  const label = dark ? lightLabel : darkLabel
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={() => onChange(dark ? 'light' : 'dark')}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        dark && 'bg-muted text-foreground',
        className,
      )}
    >
      <SteelIcon icon={dark ? Sun03Icon : Moon02Icon} className='size-4' />
    </button>
  )
}
