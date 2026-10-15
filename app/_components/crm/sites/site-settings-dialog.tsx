'use client'

import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { crmSitesKeys } from '@/src/hooks/use-crm-sites'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import { MediaPickButton } from './media-pick-button'
import { useSiteEditor } from './site-editor-context'

/** Empty strings become `undefined` (the schema rejects blank values). */
const opt = (value: string) => value.trim() || undefined

export function SettingsField({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

/** A switch with its label and hint, as one clickable row. */
export function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string
  hint: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className='flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm'>
      <Label htmlFor={id} className='grid gap-0.5 font-normal'>
        {label}
        <span className='text-muted-foreground text-xs'>{hint}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/** Public address with another slug (same host/scheme as `url`). */
export function addressWithSlug(url: string, current: string, next: string) {
  return url.replace(current, next || current)
}

interface Draft {
  name: string
  slug: string
  titleTemplate: string
  description: string
  noindex: boolean
  faviconUrl: string
  socialImageUrl: string
  googleAnalyticsId: string
  googleTagManagerId: string
  metaPixelId: string
  cookieBanner: boolean
  cookieMessage: string
  policyUrl: string
  timezone: string
  organizationName: string
  logoUrl: string
  /** Social profiles, one per line. */
  sameAs: string
}

/** Timezones offered for the site's metrics (Brazil first). */
export const SITE_TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília (São Paulo)' },
  { value: 'America/Manaus', label: 'Manaus' },
  { value: 'America/Cuiaba', label: 'Cuiabá' },
  { value: 'America/Rio_Branco', label: 'Rio Branco' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
  { value: 'Europe/Lisbon', label: 'Lisboa' },
  { value: 'UTC', label: 'UTC' },
]

function toDraft(name: string, slug: string, settings: SiteSettingsDTO): Draft {
  return {
    name,
    slug,
    titleTemplate: settings.seo.titleTemplate ?? '',
    description: settings.seo.description ?? '',
    noindex: settings.seo.noindex ?? false,
    faviconUrl: settings.faviconUrl ?? '',
    socialImageUrl: settings.socialImageUrl ?? '',
    googleAnalyticsId: settings.tracking.googleAnalyticsId ?? '',
    googleTagManagerId: settings.tracking.googleTagManagerId ?? '',
    metaPixelId: settings.tracking.metaPixelId ?? '',
    cookieBanner: settings.cookieBanner.enabled,
    cookieMessage: settings.cookieBanner.message ?? '',
    policyUrl: settings.cookieBanner.policyUrl ?? '',
    timezone: settings.timezone ?? 'America/Sao_Paulo',
    organizationName: settings.seo.organizationName ?? '',
    logoUrl: settings.seo.logoUrl ?? '',
    sameAs: (settings.seo.sameAs ?? []).join('\n'),
  }
}

/** Social profile lines → URLs (blank lines dropped). */
export function parseSameAs(value: string): string[] | undefined {
  const urls = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return urls.length ? urls : undefined
}

function toSettings(draft: Draft): SiteSettingsDTO {
  return {
    seo: {
      titleTemplate: opt(draft.titleTemplate),
      description: opt(draft.description),
      noindex: draft.noindex || undefined,
      organizationName: opt(draft.organizationName),
      logoUrl: opt(draft.logoUrl),
      sameAs: parseSameAs(draft.sameAs),
    },
    timezone: draft.timezone,
    faviconUrl: opt(draft.faviconUrl),
    socialImageUrl: opt(draft.socialImageUrl),
    tracking: {
      googleAnalyticsId: opt(draft.googleAnalyticsId),
      googleTagManagerId: opt(draft.googleTagManagerId),
      metaPixelId: opt(draft.metaPixelId),
    },
    cookieBanner: {
      enabled: draft.cookieBanner,
      message: opt(draft.cookieMessage),
      policyUrl: opt(draft.policyUrl),
    },
  }
}

/**
 * "Configurações do site": name, address (subdomain/path), SEO defaults,
 * icon and social image, tracking ids and the cookie banner. Changes reach
 * the live site on the next publish (except the address, which moves the
 * site right away).
 */
export function SiteSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { site, api, setSite, workspaceId } = useSiteEditor()
  const queryClient = useQueryClient()
  const id = useId()
  const [draft, setDraft] = useState(() =>
    toDraft(site.name, site.slug, site.settings),
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(toDraft(site.name, site.slug, site.settings))
  }, [open, site])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) {
      notify.error('Dê um nome ao site.')
      return
    }
    setSaving(true)
    try {
      const slug = draft.slug.trim().toLowerCase()
      const saved = await api.update(site.id, {
        name: draft.name.trim(),
        ...(slug && slug !== site.slug ? { slug } : {}),
        settings: toSettings(draft),
      })
      setSite(saved)
      void queryClient.invalidateQueries({
        queryKey: crmSitesKeys.list(workspaceId),
      })
      notify.success('Configurações salvas.')
      onOpenChange(false)
    } catch (error) {
      notify.error(error, 'Não foi possível salvar as configurações')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl' data-testid='site-settings'>
        <form onSubmit={submit} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>Configurações do site</DialogTitle>
            <DialogDescription>
              Valem para todas as páginas. Entram no ar na próxima publicação.
            </DialogDescription>
          </DialogHeader>
          <div className='-mx-1 grid max-h-[60vh] gap-5 overflow-y-auto px-1'>
            <section className='grid gap-3'>
              <SettingsField label='Nome do site' htmlFor={`${id}-name`}>
                <Input
                  id={`${id}-name`}
                  value={draft.name}
                  maxLength={120}
                  onChange={(event) => set('name', event.target.value)}
                />
              </SettingsField>
              <SettingsField
                label='Endereço'
                htmlFor={`${id}-slug`}
                hint={
                  <>
                    {addressWithSlug(site.url, site.slug, draft.slug.trim())}
                    {site.status === 'PUBLISHED'
                      ? ' · Mudar o endereço tira o site do endereço antigo na hora.'
                      : ''}
                  </>
                }
              >
                <Input
                  id={`${id}-slug`}
                  value={draft.slug}
                  maxLength={63}
                  onChange={(event) =>
                    set('slug', event.target.value.toLowerCase())
                  }
                />
              </SettingsField>
            </section>

            <section className='grid gap-3'>
              <h3 className='font-medium text-sm'>
                Buscadores e redes sociais
              </h3>
              <SettingsField
                label='Modelo do título'
                htmlFor={`${id}-title`}
                hint='Use %s para o título da página. Ex.: %s | Clínica São Lucas'
              >
                <Input
                  id={`${id}-title`}
                  value={draft.titleTemplate}
                  maxLength={120}
                  placeholder='%s | Nome do site'
                  onChange={(event) => set('titleTemplate', event.target.value)}
                />
              </SettingsField>
              <SettingsField
                label='Descrição padrão'
                htmlFor={`${id}-description`}
                hint={`${draft.description.length}/320 · Usada nas páginas sem descrição própria.`}
              >
                <Textarea
                  id={`${id}-description`}
                  rows={2}
                  value={draft.description}
                  maxLength={320}
                  onChange={(event) => set('description', event.target.value)}
                />
              </SettingsField>
              <SettingsField
                label='Imagem para redes sociais'
                htmlFor={`${id}-social`}
              >
                <div className='flex gap-2'>
                  <Input
                    id={`${id}-social`}
                    value={draft.socialImageUrl}
                    placeholder='https://'
                    onChange={(event) =>
                      set('socialImageUrl', event.target.value)
                    }
                  />
                  <MediaPickButton
                    workspaceId={workspaceId}
                    label='Mídia'
                    onPick={(url) => set('socialImageUrl', url)}
                  />
                </div>
              </SettingsField>
              <SettingsField label='Ícone (favicon)' htmlFor={`${id}-favicon`}>
                <div className='flex gap-2'>
                  <Input
                    id={`${id}-favicon`}
                    value={draft.faviconUrl}
                    placeholder='https://'
                    onChange={(event) => set('faviconUrl', event.target.value)}
                  />
                  <MediaPickButton
                    workspaceId={workspaceId}
                    label='Mídia'
                    onPick={(url) => set('faviconUrl', url)}
                  />
                </div>
              </SettingsField>
              <SwitchRow
                label='Esconder o site dos buscadores'
                hint='Google e outros deixam de indexar todas as páginas.'
                checked={draft.noindex}
                onCheckedChange={(checked) => set('noindex', checked)}
              />
            </section>

            <section className='grid gap-3'>
              <h3 className='font-medium text-sm'>Empresa nos buscadores</h3>
              <p className='-mt-2 text-muted-foreground text-xs'>
                Vai nos dados estruturados (schema.org) de todas as páginas.
              </p>
              <div className='grid gap-3 sm:grid-cols-2'>
                <SettingsField
                  label='Nome da empresa'
                  htmlFor={`${id}-org`}
                  hint='Vazio usa o nome do site.'
                >
                  <Input
                    id={`${id}-org`}
                    value={draft.organizationName}
                    maxLength={120}
                    onChange={(event) =>
                      set('organizationName', event.target.value)
                    }
                  />
                </SettingsField>
                <SettingsField label='Logo' htmlFor={`${id}-logo`}>
                  <div className='flex gap-2'>
                    <Input
                      id={`${id}-logo`}
                      value={draft.logoUrl}
                      placeholder='https://'
                      onChange={(event) => set('logoUrl', event.target.value)}
                    />
                    <MediaPickButton
                      workspaceId={workspaceId}
                      label='Mídia'
                      onPick={(url) => set('logoUrl', url)}
                    />
                  </div>
                </SettingsField>
              </div>
              <SettingsField
                label='Perfis nas redes sociais'
                htmlFor={`${id}-same`}
                hint='Um endereço completo por linha (Instagram, LinkedIn…).'
              >
                <Textarea
                  id={`${id}-same`}
                  rows={2}
                  value={draft.sameAs}
                  placeholder='https://instagram.com/suaempresa'
                  onChange={(event) => set('sameAs', event.target.value)}
                />
              </SettingsField>
            </section>

            <section className='grid gap-3'>
              <h3 className='font-medium text-sm'>Métricas</h3>
              <SettingsField
                label='Fuso horário das métricas'
                htmlFor={`${id}-tz`}
                hint='Os dias das métricas do site são contados neste fuso.'
              >
                <Select
                  value={draft.timezone}
                  onValueChange={(value) => {
                    if (typeof value === 'string') set('timezone', value)
                  }}
                >
                  <SelectTrigger id={`${id}-tz`} className='w-full'>
                    <SelectValue>
                      {(value: string | null) =>
                        SITE_TIMEZONES.find((tz) => tz.value === value)
                          ?.label ?? value
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SITE_TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsField>
              <p className='text-muted-foreground text-xs'>
                Google Analytics, Tag Manager e Pixel só carregam depois que o
                visitante aceita os cookies: com qualquer um deles preenchido, o
                aviso de cookies aparece mesmo desligado abaixo (LGPD).
              </p>
              <div className='grid gap-3 sm:grid-cols-3'>
                <SettingsField label='Google Analytics' htmlFor={`${id}-ga`}>
                  <Input
                    id={`${id}-ga`}
                    value={draft.googleAnalyticsId}
                    placeholder='G-XXXXXXX'
                    onChange={(event) =>
                      set('googleAnalyticsId', event.target.value.trim())
                    }
                  />
                </SettingsField>
                <SettingsField label='Tag Manager' htmlFor={`${id}-gtm`}>
                  <Input
                    id={`${id}-gtm`}
                    value={draft.googleTagManagerId}
                    placeholder='GTM-XXXXXX'
                    onChange={(event) =>
                      set('googleTagManagerId', event.target.value.trim())
                    }
                  />
                </SettingsField>
                <SettingsField label='Pixel da Meta' htmlFor={`${id}-pixel`}>
                  <Input
                    id={`${id}-pixel`}
                    value={draft.metaPixelId}
                    inputMode='numeric'
                    onChange={(event) =>
                      set('metaPixelId', event.target.value.trim())
                    }
                  />
                </SettingsField>
              </div>
            </section>

            <section className='grid gap-3'>
              <SwitchRow
                label='Aviso de cookies'
                hint='Métricas só carregam depois que o visitante aceita.'
                checked={draft.cookieBanner}
                onCheckedChange={(checked) => set('cookieBanner', checked)}
              />
              {draft.cookieBanner ? (
                <>
                  <SettingsField label='Mensagem' htmlFor={`${id}-cookie`}>
                    <Textarea
                      id={`${id}-cookie`}
                      rows={2}
                      maxLength={400}
                      value={draft.cookieMessage}
                      placeholder='Usamos cookies para melhorar sua experiência.'
                      onChange={(event) =>
                        set('cookieMessage', event.target.value)
                      }
                    />
                  </SettingsField>
                  <SettingsField
                    label='Política de privacidade'
                    htmlFor={`${id}-policy`}
                  >
                    <Input
                      id={`${id}-policy`}
                      value={draft.policyUrl}
                      placeholder='https:// ou /privacidade'
                      onChange={(event) => set('policyUrl', event.target.value)}
                    />
                  </SettingsField>
                </>
              ) : null}
            </section>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
