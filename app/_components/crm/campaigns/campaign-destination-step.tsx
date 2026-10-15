'use client'

import {
  BrowserIcon,
  FormIcon,
  LinkSquare02Icon,
  RefreshIcon,
  Search01Icon,
  WebDesign01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { SiteStatusBadge } from '@/app/_components/crm/sites/site-status-badge'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type {
  CrmCampaignDetailDTO,
  CrmCampaignOptionsDTO,
  CrmCampaignSiteOptionDTO,
} from '@/types/crm-campaign'
import type { CampaignDraft, DraftChange } from './campaign-draft'
import { CampaignSiteThumbnail } from './campaign-site-thumbnail'
import { CopyLinkRow, campaignLinks } from './campaign-steps'

type Tab = 'sites' | 'forms' | 'legacy'
type StatusFilter = 'all' | 'published' | 'draft'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Rascunhos' },
]

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function matches(query: string, ...values: string[]) {
  const needle = normalize(query.trim())
  return !needle || values.some((value) => normalize(value).includes(needle))
}

function keepStatus(filter: StatusFilter, published: boolean) {
  return (
    filter === 'all' ||
    (filter === 'published' && published) ||
    (filter === 'draft' && !published)
  )
}

function tabOf(draft: CampaignDraft): Tab {
  if (draft.destinationType === 'FORM') return 'forms'
  if (draft.destinationType === 'LANDING_PAGE') return 'legacy'
  return 'sites'
}

/** Clears every destination id but the chosen one. */
function pick(
  patch: Pick<CampaignDraft, 'destinationType'> & Partial<CampaignDraft>,
): Partial<CampaignDraft> {
  return {
    landingPageId: null,
    formId: null,
    siteId: null,
    sitePageId: null,
    ...patch,
  }
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '')
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className='rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm'>
      {children}
    </p>
  )
}

function SiteCard({
  site,
  selected,
  workspaceId,
  workspaceSlug,
  onSelect,
}: {
  site: CrmCampaignSiteOptionDTO
  selected: boolean
  workspaceId: string
  workspaceSlug: string
  onSelect: () => void
}) {
  const editorHref = `/${workspaceSlug}/crm/sites/${site.id}`
  return (
    <li
      data-testid={`campaign-site-${site.id}`}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow',
        selected && 'border-primary ring-1 ring-primary',
        site.published ? 'hover:shadow-md' : 'opacity-80',
      )}
    >
      <button
        type='button'
        onClick={onSelect}
        disabled={!site.published}
        aria-pressed={selected}
        aria-label={`Usar o site ${site.name}`}
        className='block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed'
      >
        <CampaignSiteThumbnail
          workspaceId={workspaceId}
          siteId={site.id}
          pageId={null}
          updatedAt={site.updatedAt}
          className='border-b'
        />
      </button>
      <div className='flex min-w-0 flex-col gap-1.5 p-3'>
        <div className='flex min-w-0 items-start justify-between gap-2'>
          <span className='min-w-0 truncate font-medium text-sm'>
            {site.name}
          </span>
          <SiteStatusBadge status={site.published ? 'PUBLISHED' : 'DRAFT'} />
        </div>
        <span className='truncate text-muted-foreground text-xs'>
          {hostOf(site.url)}
        </span>
        {site.published ? (
          <span className='text-muted-foreground text-xs'>
            {site.pages.length === 1
              ? '1 página no ar'
              : `${site.pages.length} páginas no ar`}
          </span>
        ) : (
          <p className='text-muted-foreground text-xs'>
            Publique o site primeiro.{' '}
            <Link
              href={editorHref}
              className='font-medium text-foreground underline-offset-4 hover:underline'
            >
              Abrir no editor
            </Link>
          </p>
        )}
      </div>
    </li>
  )
}

function SitesTab({
  draft,
  onChange,
  options,
  workspaceId,
  workspaceSlug,
  query,
  filter,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  workspaceId: string
  workspaceSlug: string
  query: string
  filter: StatusFilter
}) {
  const sites = options.sites.filter(
    (site) =>
      keepStatus(filter, site.published) &&
      matches(query, site.name, site.slug, ...site.pages.map((p) => p.title)),
  )
  if (options.sites.length === 0) {
    return (
      <Empty>
        Nenhum site criado ainda.{' '}
        <Link
          href={`/${workspaceSlug}/crm/sites`}
          className='font-medium text-foreground underline-offset-4 hover:underline'
        >
          Criar um site
        </Link>
      </Empty>
    )
  }
  if (sites.length === 0) return <Empty>Nenhum site encontrado.</Empty>
  return (
    <ul className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
      {sites.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          selected={
            draft.destinationType === 'SITE_PAGE' && draft.siteId === site.id
          }
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onSelect={() =>
            onChange(
              pick({
                destinationType: 'SITE_PAGE',
                siteId: site.id,
                sitePageId:
                  (site.pages.find((page) => page.isHome) ?? site.pages[0])
                    ?.id ?? null,
              }),
            )
          }
        />
      ))}
    </ul>
  )
}

function FormsTab({
  draft,
  onChange,
  options,
  workspaceSlug,
  query,
  filter,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  workspaceSlug: string
  query: string
  filter: StatusFilter
}) {
  const forms = options.forms.filter(
    (form) =>
      keepStatus(filter, form.published) &&
      matches(query, form.name, ...form.embeds.map((e) => e.siteName)),
  )
  if (options.forms.length === 0) {
    return (
      <Empty>
        Nenhum formulário criado ainda.{' '}
        <Link
          href={`/${workspaceSlug}/crm/forms`}
          className='font-medium text-foreground underline-offset-4 hover:underline'
        >
          Criar um formulário
        </Link>
      </Empty>
    )
  }
  if (forms.length === 0) return <Empty>Nenhum formulário encontrado.</Empty>
  return (
    <ul className='flex flex-col gap-2'>
      {forms.map((form) => {
        const selected =
          draft.destinationType === 'FORM' && draft.formId === form.id
        return (
          <li
            key={form.id}
            data-testid={`campaign-form-${form.id}`}
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-xl border p-3',
              selected && 'border-primary ring-1 ring-primary',
            )}
          >
            <div className='flex min-w-0 items-start gap-3'>
              <SteelIcon
                icon={FormIcon}
                size={18}
                className='mt-0.5 shrink-0 text-primary'
              />
              <button
                type='button'
                aria-pressed={selected}
                onClick={() =>
                  onChange(pick({ destinationType: 'FORM', formId: form.id }))
                }
                className='min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
              >
                <span className='flex min-w-0 flex-wrap items-center gap-2'>
                  <span className='truncate font-medium text-sm'>
                    {form.name}
                  </span>
                  {form.published ? null : (
                    <Badge variant='outline'>Rascunho</Badge>
                  )}
                </span>
                <span className='block truncate text-muted-foreground text-xs'>
                  {hostOf(form.url)}
                </span>
              </button>
            </div>
            {form.embeds.length > 0 ? (
              <div className='flex min-w-0 flex-wrap items-center gap-1.5 pl-8 text-xs'>
                <span className='text-muted-foreground'>No site:</span>
                {form.embeds.map((embed) => (
                  <button
                    key={`${embed.siteId}-${embed.pageId}`}
                    type='button'
                    title='Usar esta página do site como destino'
                    onClick={() =>
                      onChange(
                        pick({
                          destinationType: 'SITE_PAGE',
                          siteId: embed.siteId,
                          sitePageId: embed.pageId,
                        }),
                      )
                    }
                    className='max-w-full truncate rounded-md border px-1.5 py-0.5 hover:bg-muted'
                  >
                    {embed.siteName} › {embed.pageTitle}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function LegacyTab({
  draft,
  onChange,
  options,
  workspaceSlug,
  query,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  workspaceSlug: string
  query: string
}) {
  const pages = options.landingPages.filter((page) =>
    matches(query, page.title),
  )
  return (
    <div className='flex flex-col gap-3'>
      <p className='rounded-xl border bg-muted/30 p-3 text-sm'>
        Estas landing pages ainda não foram migradas para <strong>Sites</strong>
        . Migre para editar no novo construtor e medir a campanha nas métricas
        do site.{' '}
        <Link
          href={`/${workspaceSlug}/crm/sites`}
          className='font-medium underline-offset-4 hover:underline'
        >
          Migrar para Sites
        </Link>
      </p>
      {pages.length === 0 ? (
        <Empty>Nenhuma landing page antiga encontrada.</Empty>
      ) : (
        <ul className='flex flex-col gap-2'>
          {pages.map((page) => {
            const selected =
              draft.destinationType === 'LANDING_PAGE' &&
              draft.landingPageId === page.id
            return (
              <li key={page.id}>
                <button
                  type='button'
                  aria-pressed={selected}
                  onClick={() =>
                    onChange(
                      pick({
                        destinationType: 'LANDING_PAGE',
                        landingPageId: page.id,
                      }),
                    )
                  }
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 rounded-xl border p-3 text-left hover:bg-muted/40',
                    selected && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <SteelIcon
                    icon={BrowserIcon}
                    size={18}
                    className='shrink-0 text-muted-foreground'
                  />
                  <span className='min-w-0 flex-1 truncate text-sm'>
                    {page.title}
                  </span>
                  <Badge variant='secondary'>Landing page antiga</Badge>
                  {page.published ? null : (
                    <Badge variant='outline'>Rascunho</Badge>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The chosen destination: site page (with its thumbnail), form or legacy
 * landing page, with its public address. */
export function DestinationPreview({
  draft,
  onChange,
  options,
  campaign,
  workspaceId,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  campaign: CrmCampaignDetailDTO
  workspaceId: string
}) {
  if (draft.destinationType === 'SITE_PAGE') {
    const site = options.sites.find((item) => item.id === draft.siteId)
    if (!site) {
      return (
        <Empty>
          {campaign.destination?.type === 'SITE_PAGE'
            ? `${campaign.destination.name} não está mais disponível.`
            : 'Escolha um site publicado.'}
        </Empty>
      )
    }
    const page = site.pages.find((item) => item.id === draft.sitePageId)
    return (
      <div className='flex min-w-0 flex-col gap-3'>
        <CampaignSiteThumbnail
          workspaceId={workspaceId}
          siteId={site.id}
          pageId={page?.id ?? null}
          updatedAt={site.updatedAt}
          className='rounded-xl border'
        />
        <div className='flex flex-col gap-2'>
          <Label htmlFor='destination-page'>Página do site</Label>
          <Select
            items={site.pages.map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            value={draft.sitePageId}
            onValueChange={(value) => onChange({ sitePageId: value as string })}
          >
            <SelectTrigger id='destination-page' className='w-full'>
              <SelectValue placeholder='Escolha a página' />
            </SelectTrigger>
            <SelectContent>
              {site.pages.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                  {item.isHome ? ' (início)' : ` · /${item.path}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {page ? <OpenLink url={page.url} /> : null}
      </div>
    )
  }

  if (draft.destinationType === 'FORM') {
    const form = options.forms.find((item) => item.id === draft.formId)
    if (!form) return <Empty>Escolha um formulário.</Empty>
    return (
      <div className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'>
        <span className='flex items-center gap-2 font-medium text-sm'>
          <SteelIcon icon={FormIcon} size={18} className='text-primary' />
          {form.name}
        </span>
        {form.published ? null : (
          <p className='text-muted-foreground text-xs'>
            <Badge variant='outline'>Rascunho</Badge> Publique antes de enviar —
            senão o link abre uma página indisponível.
          </p>
        )}
        <p className='text-muted-foreground text-xs'>
          O contato cai na página pública do formulário e vira lead ao enviar.
          {form.embeds.length > 0
            ? ` Ele também está em ${form.embeds.length} página(s) de site — envios lá também contam.`
            : ''}
        </p>
        <OpenLink url={form.url} />
      </div>
    )
  }

  if (draft.destinationType === 'LANDING_PAGE') {
    const page = options.landingPages.find(
      (item) => item.id === draft.landingPageId,
    )
    return (
      <div className='flex min-w-0 flex-col gap-3 rounded-xl border p-4'>
        <span className='flex flex-wrap items-center gap-2 font-medium text-sm'>
          {page?.title ?? campaign.destination?.name ?? 'Landing page'}
          <Badge variant='secondary'>Landing page antiga</Badge>
        </span>
        <p className='text-muted-foreground text-xs'>
          Migre a página para Sites para medir a campanha nas métricas do site.
        </p>
        {campaign.links.destination ? (
          <OpenLink url={campaign.links.destination} />
        ) : null}
      </div>
    )
  }

  return <Empty>Escolha para onde o link da campanha leva.</Empty>
}

function OpenLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target='_blank'
      rel='noopener noreferrer'
      className='flex min-w-0 items-center gap-1.5 text-primary text-xs underline-offset-4 hover:underline'
    >
      <SteelIcon icon={LinkSquare02Icon} size={14} className='shrink-0' />
      <span className='truncate'>{hostOf(url)}</span>
    </a>
  )
}

/**
 * Step 1 — "Destino": a page of a published site, a CRM form (with the site
 * pages it is embedded in) or a legacy landing page not migrated yet.
 * Search, status filter and a preview of the choice.
 */
export function DestinationStep({
  draft,
  onChange,
  options,
  campaign,
  workspaceId,
  workspaceSlug,
  onRefreshOptions,
}: {
  draft: CampaignDraft
  onChange: DraftChange
  options: CrmCampaignOptionsDTO
  campaign: CrmCampaignDetailDTO
  workspaceId: string
  workspaceSlug: string
  onRefreshOptions: () => void
}) {
  const [tab, setTab] = useState<Tab>(() => tabOf(draft))
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const links = campaignLinks(draft, campaign.slug, options)
  const showLegacy =
    options.landingPages.length > 0 || draft.destinationType === 'LANDING_PAGE'

  const tabs: { value: Tab; label: string; icon: typeof FormIcon }[] = [
    {
      value: 'sites',
      label: `Sites (${options.sites.length})`,
      icon: WebDesign01Icon,
    },
    {
      value: 'forms',
      label: `Formulários (${options.forms.length})`,
      icon: FormIcon,
    },
    ...(showLegacy
      ? [
          {
            value: 'legacy' as const,
            label: `Landing pages antigas (${options.landingPages.length})`,
            icon: BrowserIcon,
          },
        ]
      : []),
  ]

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-3'>
        <div
          role='tablist'
          aria-label='Tipo de destino'
          className='flex max-w-full flex-wrap gap-1 self-start rounded-lg border p-1'
        >
          {tabs.map((item) => (
            <button
              key={item.value}
              type='button'
              role='tab'
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                tab === item.value
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <SteelIcon icon={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center'>
          <div className='relative min-w-0 sm:max-w-xs sm:flex-1'>
            <SteelIcon
              icon={Search01Icon}
              size={16}
              className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 text-muted-foreground'
            />
            <Input
              aria-label='Buscar destino'
              placeholder='Buscar…'
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className='pl-8'
            />
          </div>
          {tab !== 'legacy' ? (
            <Select
              items={STATUS_FILTERS}
              value={filter}
              onValueChange={(value) => setFilter(value as StatusFilter)}
            >
              <SelectTrigger
                aria-label='Filtrar por situação'
                className='w-full sm:w-40'
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type='button'
            variant='ghost'
            onClick={onRefreshOptions}
            aria-label='Atualizar lista'
            className='self-start sm:self-auto'
          >
            <SteelIcon icon={RefreshIcon} />
          </Button>
        </div>
      </div>

      <div className='grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]'>
        <div className='min-w-0' role='tabpanel'>
          {tab === 'sites' ? (
            <SitesTab
              draft={draft}
              onChange={onChange}
              options={options}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              query={query}
              filter={filter}
            />
          ) : tab === 'forms' ? (
            <FormsTab
              draft={draft}
              onChange={onChange}
              options={options}
              workspaceSlug={workspaceSlug}
              query={query}
              filter={filter}
            />
          ) : (
            <LegacyTab
              draft={draft}
              onChange={onChange}
              options={options}
              workspaceSlug={workspaceSlug}
              query={query}
            />
          )}
        </div>
        <aside
          aria-label='Destino escolhido'
          className='flex min-w-0 flex-col gap-2'
        >
          <span className='font-medium text-sm'>Destino escolhido</span>
          <DestinationPreview
            draft={draft}
            onChange={onChange}
            options={options}
            campaign={campaign}
            workspaceId={workspaceId}
          />
        </aside>
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='utm-medium'>utm_medium</Label>
        <Input
          id='utm-medium'
          className='sm:w-64'
          value={draft.utmMedium}
          onChange={(e) =>
            onChange({ utmMedium: e.target.value.replace(/[^a-z0-9_-]/gi, '') })
          }
        />
        <p className='text-muted-foreground text-xs'>
          utm_source é o canal (email ou whatsapp) e utm_campaign é{' '}
          <code>{campaign.slug}</code>.
        </p>
      </div>

      {links ? (
        <div className='flex flex-col gap-3 rounded-xl border bg-muted/30 p-4'>
          <p className='font-medium text-sm'>Links da campanha</p>
          <CopyLinkRow label='Link do e-mail' url={links.email} />
          <CopyLinkRow label='Link do WhatsApp' url={links.whatsapp} />
          <p className='text-muted-foreground text-xs'>
            Nos envios, cada contato recebe a própria versão rastreada destes
            links — é ela que conta cliques e conversões.
          </p>
        </div>
      ) : null}
    </div>
  )
}
