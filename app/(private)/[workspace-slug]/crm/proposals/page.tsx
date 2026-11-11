import { redirect } from 'next/navigation'

/** Propostas moved to CRM > Documentos (ADR 0063): a proposal is a kind. */
export default async function CrmProposalsRedirect({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/crm/documents?kind=PROPOSAL`)
}
