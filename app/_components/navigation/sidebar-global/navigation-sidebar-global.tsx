'use client'

import { usePathname } from 'next/navigation'
import { Fragment } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { globalNavItems, isGlobalNavActive } from './navigation-global-items'
import { GlobalButtonNavigation } from './navigation-sidebar-global-button'
import { GlobalStickiesButton } from './navigation-sidebar-global-stickies'

/**
 * Global module rail. Hidden below `md` (the mobile drawer carries the same
 * items there), icon-only between `md` and `lg`, icon + label from `lg` up.
 */
export function GlobalSidebarNavigation({
  slug,
  wikiEnabled = false,
  whiteboardEnabled = false,
}: {
  slug: string
  wikiEnabled?: boolean
  whiteboardEnabled?: boolean
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label='Módulos'
      data-tour='app-modules'
      className='hidden h-screen shrink-0 px-1.5 py-3 md:block lg:px-2'
    >
      <div className='h-fit flex flex-col justify-between gap-3'>
        {globalNavItems(slug, { wikiEnabled, whiteboardEnabled }).map(
          (item) => (
            <Fragment key={item.href}>
              {item.separated && <div className='w-full h-px bg-secondary' />}
              <GlobalButtonNavigation
                linkNavigation={item.href}
                description={item.label}
                active={isGlobalNavActive(pathname, item.href)}
                shortcut={item.shortcut}
              >
                <SteelIcon icon={item.icon} className='size-5' />
              </GlobalButtonNavigation>
            </Fragment>
          ),
        )}
        <GlobalStickiesButton />
      </div>
    </nav>
  )
}
