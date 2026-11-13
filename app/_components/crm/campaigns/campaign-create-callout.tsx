'use client'

import { Add01Icon } from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'

/** Opens a creation screen in another tab, so the campaign draft stays
 * open; the pickers reload when the user comes back to this tab. */
export function CreateLinkButton({
  href,
  children,
  variant = 'outline',
}: {
  href: string
  children: ReactNode
  variant?: 'default' | 'outline'
}) {
  return (
    <Button
      variant={variant}
      nativeButton={false}
      render={
        <Link href={href} target='_blank' rel='noopener noreferrer'>
          <SteelIcon icon={Add01Icon} /> {children}
        </Link>
      }
    />
  )
}

/**
 * Empty state of a campaign picker: says what is missing, why the campaign
 * needs it, and carries the button that goes to where it is created.
 */
export function CreateCallout({
  title,
  description,
  children,
}: {
  title: string
  description: string
  /** The action: a `CreateLinkButton` or a button of the wizard. */
  children: ReactNode
}) {
  return (
    <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center'>
      <div className='flex flex-col gap-1'>
        <p className='font-medium text-sm'>{title}</p>
        <p className='text-muted-foreground text-sm'>{description}</p>
      </div>
      {children}
    </div>
  )
}
