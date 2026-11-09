import {
  ArrowLeft01Icon,
  Share08Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { CRM_SETTINGS_SECTIONS } from '@/app/_components/settings/crm-settings-sections'
import { hasModuleAccess } from '@/src/lib/module-access-guard'

export default async function CrmSettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  if (!(await hasModuleAccess(slug, 'CRM'))) notFound()
  const base = `/${slug}/crm`
  const groups = [...new Set(CRM_SETTINGS_SECTIONS.map((s) => s.group))]

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='Configurações do CRM' />
        <NavGroup>
          <NavItem href={base} icon={ArrowLeft01Icon}>
            Voltar ao CRM
          </NavItem>
        </NavGroup>
        {groups.map((group) => (
          <NavGroup key={group} label={group}>
            {CRM_SETTINGS_SECTIONS.filter((s) => s.group === group).map(
              (section) => (
                <NavItem
                  key={section.id}
                  href={`${base}/settings/${section.id}`}
                  icon={section.icon}
                >
                  {section.label}
                </NavItem>
              ),
            )}
          </NavGroup>
        ))}
        <NavGroup label='Integrações'>
          <NavItem href={`/${slug}/settings/social`} icon={Share08Icon}>
            Redes sociais
          </NavItem>
        </NavGroup>
      </ContextSidebar>
      <div className='h-full min-h-0 w-full min-w-0 flex-1 self-stretch overflow-y-auto'>
        {children}
      </div>
    </>
  )
}
