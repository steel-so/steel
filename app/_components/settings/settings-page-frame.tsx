import type { ReactNode } from 'react'
import {
  HeaderBreadcrumbCrumb,
  HeaderBreadcrumbList,
} from '@/app/_components/header/breadcrumb-page'
import HeaderInternalNavigation from '@/app/_components/header/header-internal-navigation'
import { SteelIcon } from '@/components/icon/icon'
import { H3 } from '@/components/typography/heading/h3'
import { Muted } from '@/components/typography/text/muted'

type IconType = Parameters<typeof SteelIcon>[0]['icon']

/** House frame of a global settings page: breadcrumb, title, description, body. */
export function SettingsPageFrame({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: IconType
  children: ReactNode
}) {
  return (
    <div className='w-full'>
      <HeaderInternalNavigation>
        <HeaderBreadcrumbList>
          <HeaderBreadcrumbCrumb title={title}>
            <SteelIcon icon={icon} strokeWidth={2} className='text-primary' />
          </HeaderBreadcrumbCrumb>
        </HeaderBreadcrumbList>
      </HeaderInternalNavigation>
      <div className='w-full max-w-3xl space-y-6 p-6'>
        <div>
          <H3>{title}</H3>
          <Muted>{description}</Muted>
        </div>
        {children}
      </div>
    </div>
  )
}
