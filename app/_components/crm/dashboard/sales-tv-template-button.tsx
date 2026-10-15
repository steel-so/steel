'use client'

import { Tv01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify'
import { createCrmDashboardFromTemplate } from '@/src/hooks/use-crm-dashboard-tv'

/**
 * "Vendas — TV" em um clique: cria o painel com o kit de Vendas montado em
 * duas telas e abre o editor.
 */
export function SalesTvTemplateButton({
  workspaceId,
  slug,
}: {
  workspaceId: string
  slug: string
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)

  async function handleCreate() {
    setCreating(true)
    try {
      const dashboard = await createCrmDashboardFromTemplate(
        workspaceId,
        'sales-tv',
      )
      notify.success('Painel "Vendas — TV" criado')
      router.push(`/${slug}/crm/dashboards/${dashboard.id}`)
    } catch (error) {
      notify.error(error)
      setCreating(false)
    }
  }

  return (
    <div className='flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center'>
      <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
        <SteelIcon icon={Tv01Icon} strokeWidth={2} className='size-5' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='font-medium text-sm'>Painel de Vendas para a TV</p>
        <p className='text-muted-foreground text-sm'>
          Meta do mês, ranking, vitórias ao vivo, pipeline ponderado e placar do
          dia — pronto para a TV da sala de vendas.
        </p>
      </div>
      <Button onClick={handleCreate} disabled={creating} className='shrink-0'>
        {creating ? 'Criando…' : 'Criar "Vendas — TV"'}
      </Button>
    </div>
  )
}
