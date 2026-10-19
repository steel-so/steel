import { redirect } from 'next/navigation'

/** The Apollo import now lives in a modal on the leads board. */
export default async function CrmApolloImportRoute({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/crm/leads?apollo=1`)
}
