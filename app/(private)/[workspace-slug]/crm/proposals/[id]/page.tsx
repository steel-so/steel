import { notFound, redirect } from 'next/navigation'
import { getAuthSession } from '@/src/lib/auth-session'
import { DocumentLegacyImportService } from '@/src/services/document-legacy-import.service'
import { MembershipService } from '@/src/services/membership.service'

/**
 * Old proposal link → its document (ADR 0063). A proposal the migration
 * hasn't reached yet is converted now; anything else lands on the list.
 */
export default async function CrmProposalRedirect({
  params,
}: {
  params: Promise<{ 'workspace-slug': string; id: string }>
}) {
  const { 'workspace-slug': slug, id } = await params
  const list = `/${slug}/crm/documents?kind=PROPOSAL`
  if (id === 'new') redirect(list)

  const session = await getAuthSession()
  if (!session.ok) redirect('/sign-in')

  const membership = await MembershipService.getByUserAndSlug(
    session.value.user.id,
    slug,
  )
  if (!membership.ok || !membership.value) notFound()

  const document = await DocumentLegacyImportService.documentForProposal(
    session.value.user.id,
    membership.value.workspaceId,
    id,
  )
  redirect(document.ok ? `/${slug}/crm/documents/${document.value}` : list)
}
