'use client'

import { LockKeyIcon } from '@hugeicons-pro/core-stroke-rounded'
import { usePathname } from 'next/navigation'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'

const MODULE_BY_SEGMENT: Record<string, string> = {
  crm: 'CRM',
  zap: 'Comunicação',
  servicedesk: 'ServiceDesk',
}

/** Module name when the URL is `/<workspace>/<module>/...`, else `null`. */
export function moduleFromPathname(pathname: string | null): string | null {
  const [, segment] = (pathname ?? '').split('/').filter(Boolean)
  return segment ? (MODULE_BY_SEGMENT[segment] ?? null) : null
}

export function ModuleUnavailable({ moduleName }: { moduleName: string }) {
  return (
    <div className='mx-auto flex h-screen max-w-sm flex-col justify-center px-7 py-8 text-left'>
      <SteelIcon icon={LockKeyIcon} size={40} strokeWidth={2} className='mb-6' />
      <h1 className='mb-3 font-medium text-2xl leading-8'>
        {moduleName} não está habilitado
      </h1>
      <p className='mb-5 text-muted-foreground text-sm leading-5'>
        Este módulo não está habilitado para o seu workspace, ou a página não
        existe. Peça a um administrador do workspace para habilitá-lo.
      </p>
      <div className='flex items-center gap-2'>
        <Button size='sm' onClick={() => (window.location.href = '/')}>
          Ir para o início
        </Button>
      </div>
    </div>
  )
}

/** Not-found of the workspace segment: tells a disabled module from a 404. */
export function WorkspaceNotFound({
  fallback,
}: {
  fallback: React.ReactNode
}) {
  const moduleName = moduleFromPathname(usePathname())
  return moduleName ? <ModuleUnavailable moduleName={moduleName} /> : fallback
}
