import {
  Building03Icon,
  Calendar01Icon,
  ChartHistogramIcon,
  ChartLineData01Icon,
  DashboardSquare01Icon,
  DocumentValidationIcon,
  Facebook01Icon,
  FilterIcon,
  FireIcon,
  FormIcon,
  FunnelIcon,
  GitMergeIcon,
  GoogleIcon,
  InstagramIcon,
  Key01Icon,
  Link01Icon,
  Location01Icon,
  Mail01Icon,
  MailReceive01Icon,
  MailSend01Icon,
  Megaphone01Icon,
  MegaphoneIcon,
  NewsIcon,
  PackageIcon,
  PaintBoardIcon,
  QuoteUpIcon,
  RepeatIcon,
  Route01Icon,
  Search01Icon,
  Settings02Icon,
  Share08Icon,
  StarIcon,
  StickyNote01Icon,
  Store01Icon,
  TargetDollarIcon,
  TaskDone01Icon,
  TiktokIcon,
  UserCircleIcon,
  UserGroup02Icon,
  UserMultipleIcon,
  UserSearch01Icon,
  UserSearch02Icon,
  WebDesign01Icon,
  WorkflowCircle01Icon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ModuleRail } from '@/app/_components/navigation/module-rail'
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
      <ModuleRail base={base} ownRail={['/settings']}>
        <ContextSidebar>
          <ContextHeader title='CRM' />
          <NavGroup>
            <NavGroupAccordion label='Atrair' icon={MegaphoneIcon}>
              <NavGroupAccordion
                nested
                label='Site e SEO'
                icon={WebDesign01Icon}
              >
                <NavItem href={`${base}/sites`} icon={WebDesign01Icon}>
                  Sites
                </NavItem>
                <NavItem
                  href={`${base}/social/google_analytics`}
                  icon={GoogleIcon}
                >
                  Google Analytics
                </NavItem>
                <NavItem href={`${base}/seo`} icon={Search01Icon}>
                  SEO
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Redes sociais'
                icon={Share08Icon}
              >
                <NavItem href={`${base}/social/instagram`} icon={InstagramIcon}>
                  Instagram
                </NavItem>
                <NavItem href={`${base}/social/facebook`} icon={Facebook01Icon}>
                  Facebook
                </NavItem>
                <NavItem href={`${base}/social/youtube`} icon={YoutubeIcon}>
                  YouTube
                </NavItem>
                <NavItem href={`${base}/social/tiktok`} icon={TiktokIcon}>
                  TikTok
                </NavItem>
                <NavItem href={`${base}/social`} icon={Calendar01Icon}>
                  Agendar posts
                </NavItem>
                <NavItem href={`${base}/social/hook-vault`} icon={QuoteUpIcon}>
                  Ideias e conteúdos (Hook Vault)
                </NavItem>
                <NavItem
                  href={`${base}/social/competitors`}
                  icon={UserSearch02Icon}
                >
                  Concorrentes
                </NavItem>
                <NavItem href={`${base}/social/trending`} icon={FireIcon}>
                  Tendências (Em alta)
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Tráfego pago'
                icon={Megaphone01Icon}
              >
                <NavItem
                  href={`${base}/social/google_ads`}
                  icon={Megaphone01Icon}
                >
                  Google Ads
                </NavItem>
                <NavItem href={`${base}/banners`} icon={PaintBoardIcon}>
                  Banners
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Presença no Google'
                icon={Store01Icon}
              >
                <NavItem href={`${base}/google/profile`} icon={UserCircleIcon}>
                  Perfil da empresa
                </NavItem>
                <NavItem href={`${base}/google/maps`} icon={Location01Icon}>
                  Google Maps
                </NavItem>
                <NavItem href={`${base}/google/reviews`} icon={StarIcon}>
                  Avaliações
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion nested label='Link da bio' icon={Link01Icon}>
                <NavItem href={`${base}/bio-links`} icon={Link01Icon}>
                  Gerenciar links
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='E-mail marketing'
                icon={Mail01Icon}
              >
                <NavItem href={`${base}/campaigns`} icon={Megaphone01Icon}>
                  Campanhas
                </NavItem>
                <NavItem href={`${base}/newsletters`} icon={NewsIcon}>
                  Newsletters
                </NavItem>
                <NavItem href={`${base}/email-templates`} icon={Mail01Icon}>
                  Templates de e-mail
                </NavItem>
                <NavItem href={`${base}/email-campaigns`} icon={MailSend01Icon}>
                  E-mail avulso
                </NavItem>
              </NavGroupAccordion>
            </NavGroupAccordion>
          </NavGroup>
          <NavGroup>
            <NavGroupAccordion
              label='Captar e qualificar'
              icon={UserSearch01Icon}
            >
              <NavGroupAccordion nested label='Leads' icon={UserSearch01Icon}>
                <NavItem
                  href={`${base}/leads`}
                  icon={UserSearch01Icon}
                  data-tour='crm-home-leads'
                >
                  Todos os leads
                </NavItem>
                <NavItem href={`${base}/duplicates`} icon={GitMergeIcon}>
                  Duplicados
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion nested label='Formulários' icon={FormIcon}>
                <NavItem href={`${base}/forms`} icon={FormIcon}>
                  Formulários
                </NavItem>
                <NavItem href={`${base}/mailing-lists`} icon={UserGroup02Icon}>
                  Listas
                </NavItem>
                <NavItem href={`${base}/segments`} icon={FilterIcon}>
                  Segmentação
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion nested label='Prospecção' icon={Route01Icon}>
                <NavItem href={`${base}/cadences`} icon={Route01Icon}>
                  Cadências
                </NavItem>
              </NavGroupAccordion>
            </NavGroupAccordion>
          </NavGroup>
          <NavGroup>
            <NavGroupAccordion label='Relacionar' icon={UserMultipleIcon}>
              <NavGroupAccordion
                nested
                label='Contatos'
                icon={UserMultipleIcon}
              >
                <NavItem href={`${base}/people`} icon={UserMultipleIcon}>
                  Pessoas
                </NavItem>
                <NavItem href={`${base}/companies`} icon={Building03Icon}>
                  Empresas
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Comunicação'
                icon={MailReceive01Icon}
              >
                <NavItem href={`${base}/email-sync`} icon={MailReceive01Icon}>
                  Registro e histórico de e-mails
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Atividades'
                icon={TaskDone01Icon}
              >
                <NavItem href={`${base}/tasks`} icon={TaskDone01Icon}>
                  Tarefas
                </NavItem>
                <NavItem href={`${base}/tasks/calendar`} icon={Calendar01Icon}>
                  Calendário
                </NavItem>
                <NavItem href={`${base}/notes`} icon={StickyNote01Icon}>
                  Notas
                </NavItem>
              </NavGroupAccordion>
            </NavGroupAccordion>
          </NavGroup>
          <NavGroup>
            <NavGroupAccordion label='Vender' icon={TargetDollarIcon}>
              <NavGroupAccordion
                nested
                label='Oportunidades'
                icon={TargetDollarIcon}
              >
                <NavItem href={`${base}/opportunities`} icon={TargetDollarIcon}>
                  Oportunidades
                </NavItem>
                <NavItem href={`${base}/pipelines`} icon={FunnelIcon}>
                  Funis
                </NavItem>
                <NavItem href={`${base}/forecast`} icon={ChartLineData01Icon}>
                  Previsão de vendas
                </NavItem>
                <NavItem href={`${base}/products`} icon={PackageIcon}>
                  Produtos
                </NavItem>
              </NavGroupAccordion>
              <NavGroupAccordion
                nested
                label='Documentos'
                icon={DocumentValidationIcon}
              >
                <NavItem
                  href={`${base}/documents`}
                  icon={DocumentValidationIcon}
                >
                  Documentos
                </NavItem>
                <NavItem
                  href={`${base}/documents?kind=PROPOSAL`}
                  icon={DocumentValidationIcon}
                >
                  Propostas
                </NavItem>
                <NavItem
                  href={`${base}/documents?tab=modelos`}
                  icon={DocumentValidationIcon}
                >
                  Modelos de documentos
                </NavItem>
              </NavGroupAccordion>
            </NavGroupAccordion>
          </NavGroup>
          <NavGroup>
            <NavGroupAccordion label='Fidelizar' icon={RepeatIcon}>
              <NavItem href={`${base}/customers`} icon={UserMultipleIcon}>
                Clientes
              </NavItem>
              <NavItem href={`${base}/renewals`} icon={RepeatIcon}>
                Renovações
              </NavItem>
            </NavGroupAccordion>
          </NavGroup>
          <NavGroup>
            <NavGroupAccordion label='Gestão' icon={Settings02Icon}>
              <NavItem href={`${base}/workflows`} icon={WorkflowCircle01Icon}>
                Workflows
              </NavItem>
              <NavItem href={`${base}/dashboards`} icon={DashboardSquare01Icon}>
                Painéis
              </NavItem>
              <NavItem href={`${base}/reports`} icon={ChartHistogramIcon}>
                Relatórios
              </NavItem>
              {canManageKeys ? (
                <NavItem href={`${base}/integration-keys`} icon={Key01Icon}>
                  Chaves de API
                </NavItem>
              ) : null}
              <NavItem href={`${base}/settings`} icon={Settings02Icon}>
                Configurações
              </NavItem>
            </NavGroupAccordion>
          </NavGroup>
        </ContextSidebar>
      </ModuleRail>
      <RouteShortcuts
        routes={[
          { id: 'crm.go-leads', href: `${base}/leads` },
          { id: 'crm.go-opportunities', href: `${base}/opportunities` },
          { id: 'crm.go-people', href: `${base}/people` },
          { id: 'crm.go-companies', href: `${base}/companies` },
          { id: 'crm.go-tasks', href: `${base}/tasks` },
          { id: 'crm.go-proposals', href: `${base}/documents?kind=PROPOSAL` },
        ]}
      />
      {children}
    </>
  )
}
