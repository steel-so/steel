import { redirect } from 'next/navigation'

/** Wiki and Quadro-branco are now switched in Ajustes › Workspace. */
export default async function Page({
  params,
}: {
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  redirect(`/${slug}/settings/workspace`)
}
