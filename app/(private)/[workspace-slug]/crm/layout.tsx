import {
  BrowserIcon,
  Building03Icon,
  Calendar01Icon,
  ChartHistogramIcon,
  ChartLineData01Icon,
  DashboardSquare01Icon,
  DocumentValidationIcon,
  Facebook01Icon,
  FireIcon,
  FormIcon,
  FunnelIcon,
  GoogleIcon,
  InstagramIcon,
  Key01Icon,
  Linkedin01Icon,
  Mail01Icon,
  MailReceive01Icon,
  MailSend01Icon,
  Megaphone01Icon,
  MegaphoneIcon,
  NewTwitterIcon,
  PackageIcon,
  QuoteUpIcon,
  Settings02Icon,
  Share08Icon,
  StickyNote01Icon,
  TargetDollarIcon,
  TaskDone01Icon,
  TiktokIcon,
  UserGroup02Icon,
  UserMultipleIcon,
  UserSearch01Icon,
  UserSearch02Icon,
  WorkflowCircle01Icon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  ContextHeader,
  ContextSidebar,
  NavGroup,
  NavItem,
} from '@/app/_components/navigation/sidebar-context'
import { NavGroupAccordion } from '@/app/_components/navigation/sidebar-context/navigation-sidebar-context-accordion'
import { RouteShortcuts } from '@/app/_components/shortcuts/route-shortcuts'
import {
  hasModuleAccess,
  isWorkspacePrivileged,
} from '@/src/lib/module-access-guard'

export default async function CrmLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ 'workspace-slug': string }>
}) {
  const { 'workspace-slug': slug } = await params
  if (!(await hasModuleAccess(slug, 'CRM'))) notFound()
  const base = `/${slug}/crm`
  // API keys are managed by OWNER/ADMIN only (the service enforces it too).
  const canManageKeys = await isWorkspacePrivileged(slug)

  return (
    <>
      <ContextSidebar>
        <ContextHeader title='CRM' />
        <NavGroup>
          <NavItem href={`${base}/leads`} icon={UserSearch01Icon}>
            Leads
          </NavItem>
          <NavItem href={`${base}/opportunities`} icon={TargetDollarIcon}>
            Oportunidades
          </NavItem>
          <NavItem href={`${base}/companies`} icon={Building03Icon}>
            Empresas
          </NavItem>
          <NavItem href={`${base}/people`} icon={UserMultipleIcon}>
            Pessoas
          </NavItem>
          <NavItem href={`${base}/pipelines`} icon={FunnelIcon}>
            Pipelines
          </NavItem>
          <NavItem href={`${base}/products`} icon={PackageIcon}>
            Produtos
          </NavItem>
          <NavItem href={`${base}/forecast`} icon={ChartLineData01Icon}>
            Previsão
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/tasks`} icon={TaskDone01Icon}>
            Tarefas
          </NavItem>
          <NavItem href={`${base}/tasks/calendar`} icon={Calendar01Icon}>
            Calendário
          </NavItem>
          <NavItem href={`${base}/notes`} icon={StickyNote01Icon}>
            Notas
          </NavItem>
          <NavItem href={`${base}/proposals`} icon={DocumentValidationIcon}>
            Documentos
          </NavItem>
          <NavItem href={`${base}/forms`} icon={FormIcon}>
            Formulários
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavGroupAccordion label='Marketing' icon={MegaphoneIcon}>
            <NavItem href={`${base}/campaigns`} icon={Megaphone01Icon}>
              Campanhas
            </NavItem>
            <NavItem href={`${base}/email-campaigns`} icon={MailSend01Icon}>
              E-mail avulso
            </NavItem>
            <NavItem href={`${base}/email-templates`} icon={Mail01Icon}>
              Templates
            </NavItem>
            <NavItem href={`${base}/mailing-lists`} icon={UserGroup02Icon}>
              Listas
            </NavItem>
            <NavItem href={`${base}/landing-pages`} icon={BrowserIcon}>
              Páginas
            </NavItem>
          </NavGroupAccordion>
          <NavGroupAccordion label='Social' icon={Share08Icon}>
            <NavItem href={`${base}/social`} icon={Calendar01Icon}>
              Agendar posts
            </NavItem>
            <NavItem href={`${base}/social/hook-vault`} icon={QuoteUpIcon}>
              Hook Vault
            </NavItem>
            <NavItem
              href={`${base}/social/competitors`}
              icon={UserSearch02Icon}
            >
              Concorrentes
            </NavItem>
            <NavItem href={`${base}/social/trending`} icon={FireIcon}>
              Em Alta
            </NavItem>
            <NavItem href={`${base}/social/instagram`} icon={InstagramIcon}>
              Instagram
            </NavItem>
            <NavItem href={`${base}/social/facebook`} icon={Facebook01Icon}>
              Facebook
            </NavItem>
            <NavItem href={`${base}/social/tiktok`} icon={TiktokIcon}>
              TikTok
            </NavItem>
            <NavItem href={`${base}/social/youtube`} icon={YoutubeIcon}>
              YouTube
            </NavItem>
            <NavItem href={`${base}/social/google_analytics`} icon={GoogleIcon}>
              Google Analytics
            </NavItem>
            <NavItem href={`${base}/social/twitter`} icon={NewTwitterIcon}>
              X (Twitter)
            </NavItem>
            <NavItem href={`${base}/social/linkedin`} icon={Linkedin01Icon}>
              LinkedIn
            </NavItem>
            <NavItem href={`${base}/social/google_ads`} icon={Megaphone01Icon}>
              Google Ads
            </NavItem>
          </NavGroupAccordion>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/workflows`} icon={WorkflowCircle01Icon}>
            Workflows
          </NavItem>
          <NavItem href={`${base}/dashboards`} icon={DashboardSquare01Icon}>
            Painéis
          </NavItem>
          <NavItem href={`${base}/reports`} icon={ChartHistogramIcon}>
            Relatórios
          </NavItem>
        </NavGroup>
        <NavGroup>
          <NavItem href={`${base}/email-sync`} icon={MailReceive01Icon}>
            E-mail e agenda
          </NavItem>
          {canManageKeys ? (
            <NavItem href={`${base}/integration-keys`} icon={Key01Icon}>
              Chaves de API
            </NavItem>
          ) : null}
          <NavItem href={`${base}/settings`} icon={Settings02Icon}>
            Configurações
          </NavItem>
        </NavGroup>
      </ContextSidebar>
      <RouteShortcuts
        routes={[
          { id: 'crm.go-leads', href: `${base}/leads` },
          { id: 'crm.go-opportunities', href: `${base}/opportunities` },
          { id: 'crm.go-people', href: `${base}/people` },
          { id: 'crm.go-companies', href: `${base}/companies` },
          { id: 'crm.go-tasks', href: `${base}/tasks` },
          { id: 'crm.go-proposals', href: `${base}/proposals` },
        ]}
      />
      {children}
    </>
  )
}
