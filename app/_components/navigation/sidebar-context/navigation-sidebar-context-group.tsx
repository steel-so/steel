import type { ReactNode } from 'react'
import { Muted } from '@/components/typography/text/muted'

/**
 * A run of nav items. With `label` it renders a titled group (the settings
 * menus): a semibold muted heading with the items stacked right below it.
 */
export function NavGroup({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}) {
  if (!label) return <div className='space-y-0.5'>{children}</div>
  return (
    <div className='space-y-0.5'>
      <Muted className='px-2.5 pb-1 pt-2 text-xs font-semibold'>{label}</Muted>
      {children}
    </div>
  )
}
