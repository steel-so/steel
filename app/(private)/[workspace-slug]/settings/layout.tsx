import {
  AlarmClockIcon,
  BookOpen01Icon,
  Building02Icon,
  ChartRelationshipIcon,
  Notification01Icon,
  SparklesIcon,
  Upload01Icon,
  UserMultipleIcon,
  WhiteboardIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const base = `/${slug}/settings`

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='Ajustes do Workspace' />
        <NavGroup>
          <NavItem href={base} icon={Building02Icon}>
            Geral
          </NavItem>
          <NavItem href={`${base}/members`} icon={UserMultipleIcon}>
            Membros
          </NavItem>
          <NavItem href={`${base}/notifications`} icon={Notification01Icon}>
            Notificações
          </NavItem>
          <NavItem href={`${base}/exports`} icon={Upload01Icon}>
            Exportações
          </NavItem>
          <NavItem href={`${base}/worklogs`} icon={AlarmClockIcon}>
            Registros de trabalho
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/integrations`} icon={ChartRelationshipIcon}>
            Integrações
          </NavItem>
          <NavItem href={`${base}/wiki`} icon={BookOpen01Icon}>
            Wiki
          </NavItem>
          <NavItem href={`${base}/whiteboard`} icon={WhiteboardIcon}>
            Quadro-branco
          </NavItem>
          <NavItem href={`${base}/steel-intelligence`} icon={SparklesIcon}>
            Steel IA
          </NavItem>
        </NavGroup>
      </ContextSidebar>
      {/* The workspace shell clips its content area (`overflow-hidden`, children
          aligned to the top), so every settings page scrolls here — a page
          taller than the viewport would otherwise be cut off. */}
      <div
        data-slot='settings-scroll'
        className='h-full min-h-0 w-full min-w-0 flex-1 self-stretch overflow-y-auto overscroll-contain'
      >
        {children}
      </div>
    </>
  )
}
