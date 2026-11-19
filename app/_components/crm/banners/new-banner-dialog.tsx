'use client'

import { AiMagicIcon, ImageAdd01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { MediaLibraryPicker } from '@/app/_components/media/media-library-picker'
import { SteelIcon } from '@/components/icon/icon'
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
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { crmBannersApi, crmBannersKeys } from '@/src/hooks/use-crm-banners'
import {
  crmEmailMediaProvider,
  useCrmEmailBrand,
} from '@/src/hooks/use-crm-email-builder'
import { DEFAULT_FORMAT_IDS } from '@/src/lib/banners/formats'
import type { BannerContent } from '@/src/lib/banners/layout'
import {
  BANNER_TEMPLATES,
  type BannerBrand,
  buildBannerDocument,
  DEFAULT_BANNER_BRAND,
  findBannerTemplate,
  templatesForObjective,
} from '@/src/lib/banners/templates'
import {
  BANNER_AI_TONE_LABELS,
  BANNER_AI_TONES,
  BANNER_OBJECTIVE_LABELS,
  BANNER_OBJECTIVES,
  type BannerAiTone,
  type BannerObjective,
} from '@/src/schemas/crm-banner.schema'
import { Field, SelectField } from './banner-fields'
import { BannerFormatsPicker } from './banner-formats-picker'
import { BannerThumb } from './banner-thumb'
import { useBannerImageCache, useBannerImages } from './use-banner-images'

const BLANK = 'blank'

function buildDoc(input: {
  templateKey: string
  formatIds: string[]
  brand: BannerBrand
  imageUrl: string
  copy: Partial<BannerContent>
}) {
  const template =
    findBannerTemplate(
      input.templateKey === BLANK ? 'clean-light' : input.templateKey,
    ) ?? BANNER_TEMPLATES[0]
  if (!template) return null
  return buildBannerDocument({
    template,
    brand: input.brand,
    formatIds: input.formatIds,
    imageUrl: input.imageUrl,
    copy:
      input.templateKey === BLANK
        ? { headline: '', subheadline: '', cta: '', badge: '', logoUrl: '' }
        : input.copy,
  })
}

/**
 * "Novo banner": template by objective styled with the workspace brand, the
 * formats to produce, the copy (typed or written by the AI from a short
 * briefing) and a name. Creating opens the editor.
 */
export function NewBannerDialog({
  open,
  onOpenChange,
  workspaceId,
  slug,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  slug: string
  folder: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: savedBrand } = useCrmEmailBrand(workspaceId)
  const brand: BannerBrand = useMemo(
    () =>
      savedBrand
        ? {
            companyName: savedBrand.companyName,
            logoUrl: savedBrand.logoUrl,
            primaryColor: savedBrand.primaryColor,
          }
        : DEFAULT_BANNER_BRAND,
    [savedBrand],
  )

  const [objective, setObjective] = useState<BannerObjective | null>(null)
  const [templateId, setTemplateId] = useState<string>('bold-gradient')
  const [formatIds, setFormatIds] = useState<string[]>(DEFAULT_FORMAT_IDS)
  const [name, setName] = useState('')
  const [headline, setHeadline] = useState('')
  const [subheadline, setSubheadline] = useState('')
  const [cta, setCta] = useState('')
  const [badge, setBadge] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [offer, setOffer] = useState('')
  const [tone, setTone] = useState<BannerAiTone>('DIRECT')
  const [imageIdea, setImageIdea] = useState('')

  useEffect(() => {
    if (!open) return
    setObjective(null)
    setTemplateId('bold-gradient')
    setFormatIds(DEFAULT_FORMAT_IDS)
    setName('')
    setHeadline('')
    setSubheadline('')
    setCta('')
    setBadge('')
    setImageUrl('')
    setDescription('')
    setOffer('')
    setImageIdea('')
  }, [open])

  const mediaProvider = useMemo(
    () => crmEmailMediaProvider(workspaceId),
    [workspaceId],
  )
  const templates = useMemo(() => templatesForObjective(objective), [objective])

  const copy = useMemo(() => {
    const overrides: Partial<BannerContent> = {}
    if (headline.trim()) overrides.headline = headline.trim()
    if (subheadline.trim()) overrides.subheadline = subheadline.trim()
    if (cta.trim()) overrides.cta = cta.trim()
    if (badge.trim()) overrides.badge = badge.trim()
    return overrides
  }, [headline, subheadline, cta, badge])

  // Live previews of every template in the same size.
  const previews = useMemo(
    () =>
      [...templates.map((t) => t.id), BLANK].map((id) => ({
        id,
        doc: buildDoc({
          templateKey: id,
          formatIds: ['meta-1080x1080'],
          brand,
          imageUrl,
          copy,
        }),
      })),
    [templates, brand, imageUrl, copy],
  )
  const cache = useBannerImageCache(workspaceId)
  const previewFormats = useMemo(
    () => previews.flatMap((p) => p.doc?.formats ?? []),
    [previews],
  )
  const { images, fontsReady } = useBannerImages(cache, previewFormats)

  const generate = useMutation({
    mutationFn: () =>
      crmBannersApi(workspaceId).generateCopy({
        mode: 'BANNER',
        description,
        offer,
        objective,
        tone,
        companyName: brand.companyName,
        headline,
        cta,
      }),
    onSuccess: ({ variants, imageIdea: idea }) => {
      const first = variants[0]
      if (!first) return
      setHeadline(first.headline)
      setSubheadline(first.subheadline)
      setCta(first.cta)
      setBadge(first.badge)
      setImageIdea(idea)
      if (!name.trim()) setName(first.headline.slice(0, 60))
    },
    onError: (error) =>
      notify.error(error, 'A IA não conseguiu responder agora'),
  })

  const create = useMutation({
    mutationFn: () => {
      const document = buildDoc({
        templateKey: templateId,
        formatIds,
        brand,
        imageUrl,
        copy,
      })
      if (!document) throw new Error('Escolha um modelo')
      return crmBannersApi(workspaceId).create({
        name: name.trim() || 'Novo banner',
        folder,
        tags: [],
        objective,
        document,
      })
    },
    onSuccess: (banner) => {
      void queryClient.invalidateQueries({
        queryKey: crmBannersKeys.list(workspaceId),
      })
      notify.success('Banner criado.')
      router.push(`/${slug}/crm/banners/${banner.id}`)
    },
    onError: (error) => notify.error(error, 'Não foi possível criar o banner'),
  })

  const canCreate = formatIds.length > 0 && !create.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[92vh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Novo banner</DialogTitle>
          <DialogDescription>
            Escolha um modelo, os formatos e o texto. O logo e as cores da marca
            do workspace entram sozinhos.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-6'>
          <section className='grid gap-3' aria-labelledby='nb-template'>
            <div className='flex flex-wrap items-end justify-between gap-3'>
              <h3 id='nb-template' className='font-medium text-sm'>
                1. Modelo
              </h3>
              <div className='w-56'>
                <SelectField
                  label='Objetivo'
                  value={objective ?? ''}
                  options={[
                    { value: '', label: 'Todos os modelos' },
                    ...BANNER_OBJECTIVES.map((value) => ({
                      value,
                      label: BANNER_OBJECTIVE_LABELS[value],
                    })),
                  ]}
                  onChange={(value) =>
                    setObjective(
                      value === '' ? null : (value as BannerObjective),
                    )
                  }
                />
              </div>
            </div>
            <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'>
              {previews.map((preview) => {
                const template = findBannerTemplate(preview.id)
                const format = preview.doc?.formats[0]
                const active = templateId === preview.id
                return (
                  <li key={preview.id}>
                    <button
                      type='button'
                      aria-pressed={active}
                      onClick={() => setTemplateId(preview.id)}
                      className={cn(
                        'grid w-full gap-1.5 rounded-lg border p-2 text-left transition-colors hover:bg-muted/50',
                        active && 'border-primary ring-2 ring-primary/30',
                      )}
                    >
                      <span className='flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted'>
                        {format ? (
                          <BannerThumb
                            format={format}
                            images={images}
                            fontsReady={fontsReady}
                          />
                        ) : null}
                      </span>
                      <span className='font-medium text-sm'>
                        {template?.label ?? 'Em branco'}
                      </span>
                      <span className='line-clamp-2 text-muted-foreground text-xs'>
                        {template?.description ??
                          'Só o fundo e a marca, para montar do zero.'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          <section className='grid gap-3' aria-labelledby='nb-formats'>
            <h3 id='nb-formats' className='font-medium text-sm'>
              2. Formatos
            </h3>
            <BannerFormatsPicker selected={formatIds} onChange={setFormatIds} />
          </section>

          <section className='grid gap-3' aria-labelledby='nb-copy'>
            <h3 id='nb-copy' className='font-medium text-sm'>
              3. Texto e imagem
            </h3>

            <div className='grid gap-3 rounded-lg border bg-muted/30 p-3'>
              <p className='flex items-center gap-1.5 font-medium text-sm'>
                <SteelIcon icon={AiMagicIcon} className='text-primary' />
                Escrever com IA
              </p>
              <Textarea
                aria-label='Briefing para a IA'
                rows={2}
                maxLength={600}
                value={description}
                placeholder='O que você quer divulgar? Ex.: plano de internet fibra com instalação grátis para empresas'
                onChange={(event) => setDescription(event.target.value)}
              />
              <div className='grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end'>
                <Field label='Oferta (opcional)'>
                  {(id) => (
                    <Input
                      id={id}
                      value={offer}
                      maxLength={200}
                      placeholder='3 meses com 50% de desconto'
                      onChange={(event) => setOffer(event.target.value)}
                    />
                  )}
                </Field>
                <SelectField
                  label='Tom'
                  value={tone}
                  options={BANNER_AI_TONES.map((value) => ({
                    value,
                    label: BANNER_AI_TONE_LABELS[value],
                  }))}
                  onChange={setTone}
                />
                <Button
                  type='button'
                  disabled={
                    generate.isPending ||
                    !(description.trim() || headline.trim() || offer.trim())
                  }
                  onClick={() => generate.mutate()}
                >
                  {generate.isPending ? 'Escrevendo…' : 'Gerar texto'}
                </Button>
              </div>
              {imageIdea ? (
                <p className='text-muted-foreground text-xs'>
                  Imagem sugerida pela IA: {imageIdea}
                </p>
              ) : null}
            </div>

            <div className='grid gap-3 sm:grid-cols-2'>
              <Field label='Título'>
                {(id) => (
                  <Input
                    id={id}
                    value={headline}
                    maxLength={120}
                    placeholder='Deixe vazio para usar o texto do modelo'
                    onChange={(event) => setHeadline(event.target.value)}
                  />
                )}
              </Field>
              <Field label='Subtítulo'>
                {(id) => (
                  <Input
                    id={id}
                    value={subheadline}
                    maxLength={200}
                    onChange={(event) => setSubheadline(event.target.value)}
                  />
                )}
              </Field>
              <Field label='Botão'>
                {(id) => (
                  <Input
                    id={id}
                    value={cta}
                    maxLength={40}
                    onChange={(event) => setCta(event.target.value)}
                  />
                )}
              </Field>
              <Field label='Selo (opcional)'>
                {(id) => (
                  <Input
                    id={id}
                    value={badge}
                    maxLength={24}
                    placeholder='Novo, -20%…'
                    onChange={(event) => setBadge(event.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className='flex flex-wrap items-center gap-3'>
              <Button
                type='button'
                variant='outline'
                onClick={() => setPickerOpen(true)}
              >
                <SteelIcon icon={ImageAdd01Icon} />
                {imageUrl ? 'Trocar imagem' : 'Escolher imagem'}
              </Button>
              {imageUrl ? (
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => setImageUrl('')}
                >
                  Remover imagem
                </Button>
              ) : (
                <span className='text-muted-foreground text-xs'>
                  Opcional. Envie uma foto ou use uma da biblioteca.
                </span>
              )}
            </div>
          </section>

          <Field label='Nome do banner'>
            {(id) => (
              <Input
                id={id}
                value={name}
                maxLength={120}
                placeholder='Ex.: Campanha de verão'
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        </div>

        <DialogFooter>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!canCreate} onClick={() => create.mutate()}>
            {create.isPending
              ? 'Criando…'
              : `Criar com ${formatIds.length} formato${formatIds.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <MediaLibraryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        provider={mediaProvider}
        onSelect={(item) => setImageUrl(item.url)}
      />
    </Dialog>
  )
}
