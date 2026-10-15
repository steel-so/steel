'use client'

import * as React from 'react'
import type { CrmDashboardLookupsDTO } from '@/types/crm-dashboard'

/**
 * Como os widgets do dashboard são exibidos. `tv` = modo TV (tela cheia,
 * alto contraste, números enormes). `refreshKey` muda a cada atualização
 * automática: os widgets refazem a busca sem piscar (mantêm o dado anterior
 * enquanto carregam).
 *
 * `tvToken` = painel aberto pelo link público da TV (`/tv/<token>`): os
 * widgets buscam os dados pelo token em vez das rotas do workspace.
 * `lookups` = nomes de etapas, pipelines e membros já carregados (a TV
 * recebe no boot); sem eles, cada widget busca os do workspace.
 */
export interface DashboardDisplay {
  variant: 'default' | 'tv'
  refreshKey: number
  tvToken?: string
  lookups?: CrmDashboardLookupsDTO
}

const DashboardDisplayContext = React.createContext<DashboardDisplay>({
  variant: 'default',
  refreshKey: 0,
})

export function DashboardDisplayProvider({
  variant = 'default',
  refreshKey = 0,
  tvToken,
  lookups,
  children,
}: Partial<DashboardDisplay> & { children: React.ReactNode }) {
  const value = React.useMemo(
    () => ({ variant, refreshKey, tvToken, lookups }),
    [variant, refreshKey, tvToken, lookups],
  )
  return (
    <DashboardDisplayContext.Provider value={value}>
      {children}
    </DashboardDisplayContext.Provider>
  )
}

export function useDashboardDisplay(): DashboardDisplay {
  return React.useContext(DashboardDisplayContext)
}
