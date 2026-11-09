'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * Hides a module's context rail on the routes that bring their own (the
 * settings), so there is always exactly one rail. `ownRail` are path
 * prefixes under `base`. A client component because the module layout is a
 * server component and cannot read `pathname`.
 */
export function ModuleRail({
  base,
  ownRail,
  children,
}: {
  base: string
  ownRail: string[]
  children: ReactNode
}) {
  const pathname = usePathname()
  const hidden = ownRail.some((segment) =>
    pathname.startsWith(`${base}${segment}`),
  )
  return hidden ? null : children
}
