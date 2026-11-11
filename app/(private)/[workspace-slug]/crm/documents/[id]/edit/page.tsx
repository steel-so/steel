import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { DocumentEditor } from '@/app/_components/documents/editor/document-editor'
import { FocusedScreen } from '@/app/_components/layout/focused-screen'
import { getAuthSession } from '@/src/lib/auth-session'
import { MembershipService } from '@/src/services/membership.service'

export const metadata: Metadata = {
  title: 'Editor do documento | CRM | Steel',
  description: 'Editor visual dos documentos do CRM',
}

type Props = {
  params: Promise<{ 'workspace-slug': string; id: string }>
}

/** Document editor in a focused full-screen layout (no CRM navigation). */
export default async function CrmDocumentEditorPage({ params }: Props) {
  const { 'workspace-slug': slug, id } = await params

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  return (
    <FocusedScreen
      label='Editor do documento'
      mobileBack={{
        href: `/${slug}/crm/documents/${id}`,
        label: 'Voltar para o documento',
      }}
    >
      <div className='min-h-0 flex-1'>
        <DocumentEditor
          workspaceId={membership.value.workspaceId}
          slug={slug}
          documentId={id}
        />
      </div>
    </FocusedScreen>
  )
}
