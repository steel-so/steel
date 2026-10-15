'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import type { SiteAnalyticsDTO } from '@/types/site-platform'

const count = new Intl.NumberFormat('pt-BR')

/**
 * "Campanhas do CRM" of the site metrics: visits and forms sent on the
 * site that came from a CRM campaign link (ADR 0025), per campaign.
 */
export function SiteCampaignsPanel({ data }: { data: SiteAnalyticsDTO }) {
  const params = useParams<{ 'workspace-slug'?: string }>()
  const slug = params?.['workspace-slug']
  const rows = data.campaigns ?? []
  return (
    <section
      aria-labelledby='site-campaigns-title'
      className='min-w-0 rounded-xl border border-border/80 bg-card p-4'
    >
      <header className='mb-3'>
        <h2 id='site-campaigns-title' className='font-medium text-sm'>
          Campanhas do CRM
        </h2>
        <p className='text-muted-foreground text-xs'>
          Visitas e formulários que vieram do link de uma campanha.
        </p>
      </header>
      {rows.length === 0 ? (
        <EmptyState>Nenhuma visita de campanha no período.</EmptyState>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[20rem] text-sm'>
            <thead>
              <tr className='text-left text-muted-foreground text-xs'>
                <th className='pb-2 font-normal'>Campanha</th>
                <th className='pb-2 text-right font-normal'>Visitas</th>
                <th className='pb-2 text-right font-normal'>Formulários</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.campaignId} className='border-t'>
                  <td className='max-w-0 truncate py-2 pr-2'>
                    {slug ? (
                      <Link
                        href={`/${slug}/crm/campaigns/${row.campaignId}`}
                        className='hover:underline'
                      >
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    <span className='ml-1.5 text-muted-foreground text-xs'>
                      {row.slug}
                    </span>
                  </td>
                  <td className='py-2 text-right tabular-nums'>
                    {count.format(row.views)}
                  </td>
                  <td className='py-2 text-right font-medium tabular-nums'>
                    {count.format(row.formSubmissions)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
