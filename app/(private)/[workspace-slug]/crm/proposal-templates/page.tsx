import { redirect } from 'next/navigation'

/** Proposal templates are document templates now (ADR 0063). */
export default async function CrmProposalTemplatesRedirect({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/crm/documents?tab=modelos&kind=PROPOSAL`)
}
