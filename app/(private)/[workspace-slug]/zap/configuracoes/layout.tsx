import {
  ArrowLeft01Icon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { ZAP_SETTINGS_SECTIONS } from '@/app/_components/whatsapp/settings/zap-settings-sections'
import { hasModuleAccess } from '@/src/lib/module-access-guard'

export default async function ZapSettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  if (!(await hasModuleAccess(slug, 'COMMUNICATION'))) notFound()
  const base = `/${slug}/zap`
  const groups = [...new Set(ZAP_SETTINGS_SECTIONS.map((s) => s.group))]

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='Configurações do WhatsApp' />
        <NavGroup>
          <NavItem href={base} icon={ArrowLeft01Icon}>
            Voltar às conversas
          </NavItem>
        </NavGroup>
        {groups.map((group) => (
          <NavGroup key={group} label={group}>
            {ZAP_SETTINGS_SECTIONS.filter((s) => s.group === group).map(
              (section) => (
                <NavItem
                  key={section.id}
                  href={`${base}/configuracoes/${section.id}`}
                  icon={section.icon}
                >
                  {section.label}
                </NavItem>
              ),
            )}
          </NavGroup>
        ))}
        <NavGroup label='Integrações'>
          <NavItem href={`/${slug}/settings/whatsapp`} icon={WhatsappIcon}>
            Conexões do WhatsApp
          </NavItem>
        </NavGroup>
      </ContextSidebar>
      <div className='h-full min-h-0 w-full min-w-0 flex-1 self-stretch overflow-y-auto'>
        {children}
      </div>
    </>
  )
}
