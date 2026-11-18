import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import {
  AdminPage,
  AdminPageHeader,
} from '@/app/_components/admin/shell/admin-page'
import { ErrorState } from '@/app/_components/admin/shell/admin-ui'
import { AdminZapiLinePanel } from '@/app/_components/admin/zapi-line/admin-zapi-line-panel'
import { getAuthSession } from '@/src/lib/auth-session'
import { PlatformZapiLineService } from '@/src/services/platform-zapi-line.service'

export const metadata: Metadata = {
  title: 'Linha de verificação | Admin | Steel',
  description:
    'Número de WhatsApp (Z-API) que confere os contatos de todos os workspaces',
}

export default async function AdminZapiLinePage() {
  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const result = await PlatformZapiLineService.get(session.value.user.id)

  return (
    <AdminPage>
      <AdminPageHeader
        title='Linha de verificação'
        crumbs={[{ label: 'Linha de verificação' }]}
        description='Número de WhatsApp (Z-API) que confere, para todos os workspaces, se um contato tem WhatsApp'
      />
      {result.ok ? (
        <AdminZapiLinePanel initial={result.value} />
      ) : (
        <ErrorState message='Não foi possível carregar a linha de verificação.' />
      )}
    </AdminPage>
  )
}
