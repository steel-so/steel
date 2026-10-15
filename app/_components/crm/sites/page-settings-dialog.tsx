'use client'

import { useEffect, useId, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { SITE_OG_IMAGE_PATH } from '@/src/lib/sites/seo'
import {
  SITEMAP_CHANGE_FREQUENCIES,
  type SitePageSeoDTO,
} from '@/src/schemas/site-page.schema'
import type { SitePageSummaryDTO } from '@/types/site'
import { MediaPickButton } from './media-pick-button'
import { orderPages, useSiteEditor } from './site-editor-context'
import { SettingsField, SwitchRow } from './site-settings-dialog'

const ROOT = '__root'
const DEFAULT = '__default'

/** Sitemap priorities offered (the protocol's default is 0.5). */
export const SITEMAP_PRIORITIES = [
  { value: '1', label: 'Máxima (1,0)' },
  { value: '0.8', label: 'Alta (0,8)' },
  { value: '0.5', label: 'Normal (0,5)' },
  { value: '0.3', label: 'Baixa (0,3)' },
  { value: '0.1', label: 'Mínima (0,1)' },
]

export const CHANGE_FREQUENCY_LABELS: Record<
  NonNullable<SitePageSeoDTO['changeFrequency']>,
  string
> = {
  always: 'Sempre',
  hourly: 'A cada hora',
  daily: 'Diariamente',
  weekly: 'Semanalmente',
  monthly: 'Mensalmente',
  yearly: 'Anualmente',
  never: 'Nunca',
}

function DefaultableSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const label = (current: string | null) =>
    current === DEFAULT || !current
      ? 'Padrão'
      : (options.find((option) => option.value === current)?.label ?? current)
  return (
    <Select
      value={value}
      onValueChange={(next) => typeof next === 'string' && onChange(next)}
    >
      <SelectTrigger id={id} className='w-full'>
        <SelectValue>{label}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value={DEFAULT}>Padrão</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Ids of `pageId` and every page below it (cannot become its parent). */
export function descendantIds(
  pages: SitePageSummaryDTO[],
  pageId: string,
): Set<string> {
  const out = new Set([pageId])
  let grew = true
  while (grew) {
    grew = false
    for (const page of pages) {
      if (page.parentId && out.has(page.parentId) && !out.has(page.id)) {
        out.add(page.id)
        grew = true
      }
    }
  }
  return out
}

/** Google-like preview of the title and description. */
function SearchPreview({
  title,
  description,
  url,
}: {
  title: string
  description: string
  url: string
}) {
  return (
    <div className='grid gap-0.5 rounded-md border bg-muted/30 px-3 py-2.5'>
      <span className='truncate text-muted-foreground text-xs'>{url}</span>
      <span className='truncate font-medium text-primary text-sm'>{title}</span>
      <span className='line-clamp-2 text-muted-foreground text-xs'>
        {description ||
          'Sem descrição: os buscadores escolhem um trecho da página.'}
      </span>
    </div>
  )
}

/**
 * Page settings: title, address, parent page and SEO (title, description,
 * social image, hidden from search engines and menus).
 */
export function PageSettingsDialog({
  page,
  onOpenChange,
  onSaved,
}: {
  page: SitePageSummaryDTO | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { site, pages, api, workspaceId } = useSiteEditor()
  const id = useId()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState<string>(ROOT)
  const [seoTitle, setSeoTitle] = useState('')
  const [description, setDescription] = useState('')
  const [image, setImage] = useState('')
  const [noindex, setNoindex] = useState(false)
  const [canonical, setCanonical] = useState('')
  const [priority, setPriority] = useState(DEFAULT)
  const [frequency, setFrequency] = useState(DEFAULT)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!page) return
    setTitle(page.title)
    setSlug(page.slug)
    setParentId(page.parentId ?? ROOT)
    setSeoTitle(page.seo.title ?? '')
    setDescription(page.seo.description ?? '')
    setImage(page.seo.socialImageUrl ?? '')
    setNoindex(page.seo.noindex ?? false)
    setCanonical(page.seo.canonicalUrl ?? '')
    setPriority(
      page.seo.sitemapPriority === undefined
        ? DEFAULT
        : String(page.seo.sitemapPriority),
    )
    setFrequency(page.seo.changeFrequency ?? DEFAULT)
  }, [page])

  if (!page) return null
  const blocked = descendantIds(pages, page.id)
  const parents = orderPages(pages).filter((item) => !blocked.has(item.id))
  const parentPath =
    parentId === ROOT ? '' : `${pages.find((p) => p.id === parentId)?.path}/`
  const path = page.isHome ? '' : `${parentPath}${slug || page.slug}`
  const url = `${site.url.replace(/\/$/, '')}/${path}`

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!page) return
    if (!title.trim()) {
      notify.error('Dê um título à página.')
      return
    }
    setSaving(true)
    try {
      await api.updatePage(site.id, page.id, {
        title: title.trim(),
        ...(slug.trim() && slug.trim() !== page.slug
          ? { slug: slug.trim().toLowerCase() }
          : {}),
        ...((page.parentId ?? ROOT) !== parentId
          ? { parentId: parentId === ROOT ? null : parentId }
          : {}),
        seo: {
          title: seoTitle.trim() || undefined,
          description: description.trim() || undefined,
          socialImageUrl: image.trim() || undefined,
          noindex: noindex || undefined,
          canonicalUrl: canonical.trim() || undefined,
          sitemapPriority: priority === DEFAULT ? undefined : Number(priority),
          changeFrequency:
            frequency === DEFAULT
              ? undefined
              : (frequency as SitePageSeoDTO['changeFrequency']),
        },
      })
      notify.success('Página atualizada.')
      onSaved()
      onOpenChange(false)
    } catch (error) {
      notify.error(error, 'Não foi possível salvar a página')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg' data-testid='page-settings'>
        <form onSubmit={submit} className='grid gap-4'>
          <DialogHeader>
            <DialogTitle>Configurações da página</DialogTitle>
            <DialogDescription>
              Título, endereço e como a página aparece no Google e nas redes.
            </DialogDescription>
          </DialogHeader>
          <div className='-mx-1 grid max-h-[60vh] gap-4 overflow-y-auto px-1'>
            <SettingsField label='Título da página' htmlFor={`${id}-title`}>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </SettingsField>
            {page.isHome ? null : (
              <div className='grid gap-4 sm:grid-cols-2'>
                <SettingsField label='Endereço' htmlFor={`${id}-slug`}>
                  <Input
                    id={`${id}-slug`}
                    value={slug}
                    maxLength={80}
                    onChange={(event) =>
                      setSlug(event.target.value.toLowerCase())
                    }
                  />
                </SettingsField>
                <SettingsField label='Página mãe' htmlFor={`${id}-parent`}>
                  <Select
                    value={parentId}
                    onValueChange={(next) =>
                      typeof next === 'string' && setParentId(next)
                    }
                  >
                    <SelectTrigger id={`${id}-parent`} className='w-full'>
                      <SelectValue>
                        {(value: string | null) =>
                          value === ROOT || !value
                            ? 'Nenhuma (primeiro nível)'
                            : (pages.find((item) => item.id === value)?.title ??
                              'Página')
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectItem value={ROOT}>
                        Nenhuma (primeiro nível)
                      </SelectItem>
                      {parents.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          <span style={{ paddingLeft: item.depth * 12 }}>
                            {item.title}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingsField>
              </div>
            )}

            <h3 className='pt-1 font-medium text-sm'>SEO</h3>
            <SearchPreview
              title={seoTitle || title}
              description={description || site.settings.seo.description || ''}
              url={url}
            />
            <SettingsField
              label='Título nos buscadores'
              htmlFor={`${id}-seo-title`}
              hint={`${seoTitle.length}/120 · Vazio usa o título da página.`}
            >
              <Input
                id={`${id}-seo-title`}
                value={seoTitle}
                maxLength={120}
                placeholder={title}
                onChange={(event) => setSeoTitle(event.target.value)}
              />
            </SettingsField>
            <SettingsField
              label='Descrição'
              htmlFor={`${id}-seo-description`}
              hint={`${description.length}/320 · Entre 120 e 160 caracteres funciona melhor.`}
            >
              <Textarea
                id={`${id}-seo-description`}
                rows={3}
                value={description}
                maxLength={320}
                onChange={(event) => setDescription(event.target.value)}
              />
            </SettingsField>
            <SettingsField
              label='Imagem para redes sociais'
              htmlFor={`${id}-seo-image`}
              hint='Vazio usa a imagem padrão do site ou, sem ela, um cartão gerado com o título da página. Ideal: 1200 × 630 px.'
            >
              <div className='flex gap-2'>
                <Input
                  id={`${id}-seo-image`}
                  value={image}
                  placeholder='https://'
                  onChange={(event) => setImage(event.target.value)}
                />
                <MediaPickButton
                  workspaceId={workspaceId}
                  label='Mídia'
                  onPick={setImage}
                />
              </div>
            </SettingsField>
            {!image &&
            !site.settings.socialImageUrl &&
            site.status === 'PUBLISHED' ? (
              <figure className='grid gap-1'>
                <img
                  src={`${site.url.replace(/\/$/, '')}/${SITE_OG_IMAGE_PATH}?page=${encodeURIComponent(page.id)}`}
                  alt='Cartão gerado para as redes sociais'
                  width={1200}
                  height={630}
                  loading='lazy'
                  className='aspect-[1200/630] h-auto w-full rounded-md border object-cover'
                />
                <figcaption className='text-muted-foreground text-xs'>
                  Cartão gerado (versão publicada da página).
                </figcaption>
              </figure>
            ) : null}
            <SettingsField
              label='Endereço canônico'
              htmlFor={`${id}-canonical`}
              hint='Só se o mesmo conteúdo estiver em outro endereço principal. Vazio usa o endereço desta página.'
            >
              <Input
                id={`${id}-canonical`}
                value={canonical}
                placeholder='https://'
                onChange={(event) => setCanonical(event.target.value)}
              />
            </SettingsField>
            <div className='grid gap-4 sm:grid-cols-2'>
              <SettingsField
                label='Prioridade no sitemap'
                htmlFor={`${id}-priority`}
              >
                <DefaultableSelect
                  id={`${id}-priority`}
                  value={priority}
                  onChange={setPriority}
                  options={SITEMAP_PRIORITIES}
                />
              </SettingsField>
              <SettingsField
                label='Frequência de mudança'
                htmlFor={`${id}-frequency`}
              >
                <DefaultableSelect
                  id={`${id}-frequency`}
                  value={frequency}
                  onChange={setFrequency}
                  options={SITEMAP_CHANGE_FREQUENCIES.map((value) => ({
                    value,
                    label: CHANGE_FREQUENCY_LABELS[value],
                  }))}
                />
              </SettingsField>
            </div>
            <SwitchRow
              label='Esconder dos buscadores e do menu'
              hint='A página continua acessível pelo endereço.'
              checked={noindex}
              onCheckedChange={setNoindex}
            />
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
