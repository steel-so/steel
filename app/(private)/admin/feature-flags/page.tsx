import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PlatformFlagsPanel } from '@/app/_components/admin/feature-flags/platform-flags-panel'
import {
  AdminPage,
  AdminPageHeader,
} from '@/app/_components/admin/shell/admin-page'
import { getAuthSession } from '@/src/lib/auth-session'

// Página de sessão (admin): bloqueia de propósito; `loading.tsx` cobre.
export const instant = false

export const metadata: Metadata = {
  title: 'Feature flags | Admin | Steel',
  description: 'Feature flags da plataforma e workspaces beta',
}

export default async function AdminFeatureFlagsPage() {
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  return (
    <AdminPage>
      <AdminPageHeader
        title='Feature flags'
        crumbs={[{ label: 'Feature flags' }]}
        description='Uma flag vale para um workspace se estiver ligada para todos, liberada para ele ou ligada para beta e o workspace for beta.'
      />
      <PlatformFlagsPanel />
    </AdminPage>
  )
}
