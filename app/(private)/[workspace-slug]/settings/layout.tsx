import {
  AlarmClockIcon,
  Building02Icon,
  ChartRelationshipIcon,
  Chatting01Icon,
  DashboardSquare01Icon,
  Mail01Icon,
  McpServerIcon,
  Notification01Icon,
  RadarIcon,
  SecurityLockIcon,
  Share08Icon,
  SparklesIcon,
  Upload01Icon,
  UserMultipleIcon,
  WebhookIcon,
  WhatsappIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { hasModuleAccess } from '@/src/lib/module-access-guard'

export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  const base = `/${slug}/settings`
  const [communication, crm, serviceDesk] = await Promise.all([
    hasModuleAccess(slug, 'COMMUNICATION'),
    hasModuleAccess(slug, 'CRM'),
    hasModuleAccess(slug, 'SERVICE_DESK'),
  ])

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='Ajustes do Workspace' />
        <NavGroup label='Workspace'>
          <NavItem href={base} icon={Building02Icon}>
            Geral
          </NavItem>
          <NavItem href={`${base}/workspace`} icon={DashboardSquare01Icon}>
            Workspace
          </NavItem>
          <NavItem href={`${base}/members`} icon={UserMultipleIcon}>
            Membros
          </NavItem>
          <NavItem href={`${base}/notifications`} icon={Notification01Icon}>
            Notificações
          </NavItem>
          <NavItem href={`${base}/security`} icon={SecurityLockIcon}>
            Segurança
          </NavItem>
          <NavItem href={`${base}/exports`} icon={Upload01Icon}>
            Exportações
          </NavItem>
          <NavItem href={`${base}/worklogs`} icon={AlarmClockIcon}>
            Registros de trabalho
          </NavItem>
        </NavGroup>
        <NavGroup label='Integrações'>
          <NavItem href={`${base}/integrations`} icon={ChartRelationshipIcon}>
            Slack, GitHub e GitLab
          </NavItem>
          <NavItem href={`${base}/integrations/webhooks`} icon={WebhookIcon}>
            Webhooks
          </NavItem>
          <NavItem href={`${base}/connected-apps`} icon={McpServerIcon}>
            Apps conectados
          </NavItem>
          {(crm || serviceDesk) && (
            <NavItem href={`${base}/email-domains`} icon={Mail01Icon}>
              Domínios de e-mail
            </NavItem>
          )}
          {communication && (
            <NavItem href={`${base}/whatsapp`} icon={WhatsappIcon}>
              WhatsApp
            </NavItem>
          )}
          {crm && (
            <NavItem href={`${base}/social`} icon={Share08Icon}>
              Redes sociais
            </NavItem>
          )}
          {serviceDesk && (
            <NavItem href={`${base}/monitoring`} icon={RadarIcon}>
              Monitoramento
            </NavItem>
          )}
        </NavGroup>
        <NavGroup label='Inteligência e consumo'>
          <NavItem href={`${base}/steel-intelligence`} icon={SparklesIcon}>
            Steel IA
          </NavItem>
          {communication && (
            <NavItem href={`${base}/communication`} icon={Chatting01Icon}>
              Consumo do WhatsApp
            </NavItem>
          )}
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
