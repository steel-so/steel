'use client'

import { WorkspaceNotFound } from '@/app/_components/root/module-unavailable'
import SteelNotFound from '@/app/_components/root/steel-not-found'

export default function Page() {
  return <WorkspaceNotFound fallback={<SteelNotFound />} />
}
