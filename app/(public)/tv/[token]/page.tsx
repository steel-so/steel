import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { cache } from 'react'
import { CrmDashboardTvPublic } from '@/app/_components/crm/dashboard/tv/crm-dashboard-tv-screens'
import { CrmDashboardTvService } from '@/src/services/crm-dashboard-tv.service'

const loadBoot = cache(async (token: string) => {
  const result = await CrmDashboardTvService.boot(token)
  return result.ok ? result.value : null
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  await connection()
  const { token } = await params
  const boot = await loadBoot(token)
  return {
    title: boot ? `${boot.dashboard.title} | TV` : 'Painel da TV',
    // Whoever has the link sees it; search engines never do.
    robots: { index: false, follow: false },
  }
}

/**
 * Painel do CRM numa TV (`/tv/<token>`): sem login, só leitura, sem dados
 * de contato. Token desconhecido ou revogado responde 404.
 */
export default async function CrmDashboardTvLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ interval?: string }>
}) {
  await connection()
  const { token } = await params
  const { interval } = await searchParams
  const boot = await loadBoot(token)
  if (!boot) notFound()

  return <CrmDashboardTvPublic token={token} boot={boot} interval={interval} />
}
