import { redirect } from 'next/navigation'

/** Landing pages moved into CRM › Sites. */
export default async function CrmLandingPagesPage({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/crm/sites`)
}
