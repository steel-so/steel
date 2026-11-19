import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AdminServerDashboard } from '@/app/_components/admin/server/admin-server-dashboard'
import {
  AdminPage,
  AdminPageHeader,
} from '@/app/_components/admin/shell/admin-page'
import { getAuthSession } from '@/src/lib/auth-session'
import { assertPlatformAdmin } from '@/src/services/authz'

export const metadata: Metadata = {
  title: 'Servidor | Admin | Steel',
  description: 'Disco, memória, CPU, containers, Postgres e Redis',
}

export default async function AdminServerPage() {
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')
  const admin = await assertPlatformAdmin(session.value.user.id)
  if (!admin.ok) redirect('/admin')

  return (
    <AdminPage>
      <AdminPageHeader
        title='Servidor'
        crumbs={[{ label: 'Servidor' }]}
        description='Recursos do host, containers Docker, Postgres e Redis, atualizados a cada 5 segundos'
      />
      <AdminServerDashboard />
    </AdminPage>
  )
}
