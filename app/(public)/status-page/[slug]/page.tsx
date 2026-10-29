import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { SdPublicStatusPage } from '@/app/_components/status-page/sd-public-status-page'
import { SdStatusSlugParamSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'

export const metadata: Metadata = {
  title: 'Status dos serviços',
  robots: { index: false, follow: false },
}

/**
 * Página de status do cliente (sem login): o endereço é o acesso. Renderiza
 * o estado atual no servidor e o cliente atualiza a cada minuto.
 */
export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  await connection()
  const { slug } = await params
  const parsed = SdStatusSlugParamSchema.safeParse(slug)
  if (!parsed.success) notFound()

  const page = await SdStatusPageService.getPublic(parsed.data)
  if (!page.ok) notFound()

  return <SdPublicStatusPage slug={parsed.data} initial={page.value} />
}
