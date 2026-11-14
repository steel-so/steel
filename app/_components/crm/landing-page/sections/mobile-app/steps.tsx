'use client'

import { PlayIcon } from '@hugeicons-pro/core-solid-rounded'
import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { GhostVideo } from '@/components/ui/ghost-video'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  uploadCrmLandingPageImage,
  uploadCrmLandingPageVideo,
} from '@/src/hooks/use-crm-landing-page'
import { MOBILE_APP_COLORS } from '@/src/lib/landing-page-templates/mobile-app/colors'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const BASE = '/landing-page-templates/mobile-app'

const NUMBER_COLORS = [
  MOBILE_APP_COLORS.red,
  MOBILE_APP_COLORS.green,
  MOBILE_APP_COLORS.primary,
]

/**
 * O tipo STEPS cobre três blocos bem diferentes do frame "07-Mobile App"
 * (Content 01, Content 02, How e Video) — nenhum tipo dedicado de vídeo
 * existe no vocabulário compartilhado, então o banner de vídeo também usa
 * STEPS com `items: []` (ver instruções da tarefa). Como o schema não tem
 * campo de variante, o layout é inferido pela forma do conteúdo:
 * - 0 itens            → banner decorativo com botão de play (Video)
 * - 3+ itens sem imagem → passos numerados (How)
 * - 1-2 itens com imagem → vitrine imagem + lista (Content 01/02)
 */
function pickVariant(content: StepsContent): 'video' | 'numbered' | 'showcase' {
  if (content.items.length === 0) return 'video'
  if (content.items.length >= 3 && !content.imageUrl) return 'numbered'
  return 'showcase'
}

export function stepsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Como funciona?',
    subtitle:
      'Com blocos prontos, você monta sua página facilmente, sem escrever nenhum código.',
    items: [
      { title: 'Instale o app', description: '' },
      { title: 'Adicione os membros da equipe', description: '' },
      { title: 'É só começar!', description: '' },
    ],
  }
}

export function stepsShowcaseLeftDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Colabore com os membros da equipe.',
    subtitle:
      'Compartilhamos tendências e estratégias para melhorar os seus resultados.',
    imageUrl: `${BASE}/content-collaborate.png`,
    items: [
      {
        title: 'Grupos por projeto',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
      },
      {
        title: 'Reuniões em vídeo ilimitadas',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
      },
    ],
  }
}

export function stepsShowcaseRightDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Organize a equipe remota com rapidez e facilidade.',
    subtitle:
      'Compartilhamos tendências e estratégias para criar e melhorar os seus resultados.',
    imageUrl: `${BASE}/content-organize.png`,
    items: [
      {
        title: 'Crie equipes ilimitadas',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
      },
      {
        title: 'Converse com todos sem complicação',
        description:
          'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
      },
    ],
  }
}

export function stepsVideoDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Assista a uma demonstração do app',
    imageUrl: `${BASE}/video-banner.png`,
    items: [],
  }
}

export function MobileAppSteps({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<StepsContent>) {
  const variant = pickVariant(content)

  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, imageUrl: res.data.url })
  }

  async function handleVideo(file: File) {
    const res = await uploadCrmLandingPageVideo(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar o vídeo.')
      return
    }
    onChange?.({ ...content, videoUrl: res.data.url })
  }

  function updateItem(
    index: number,
    patch: Partial<{ title: string; description: string }>,
  ) {
    onChange?.({
      ...content,
      items: content.items.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      ),
    })
  }

  function addItem() {
    onChange?.({
      ...content,
      items: [...content.items, { title: 'Novo passo', description: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  if (variant === 'video') {
    return (
      <section className='bg-white px-6 py-16 sm:px-10 sm:py-20 lg:px-[123px]'>
        <div className='mx-auto max-w-5xl'>
          {!readOnly ? (
            <GhostInput
              value={content.title}
              onCommit={(v) => onChange?.({ ...content, title: v })}
              placeholder='Título (leitor de tela)'
              readOnly={readOnly}
              className='mb-3 text-[#161c2d]/50 text-xs'
            />
          ) : null}
          <div className='relative overflow-hidden rounded-[20px]'>
            {content.videoUrl ? (
              <GhostVideo
                value={content.videoUrl}
                onUpload={handleVideo}
                readOnly={readOnly}
                className='aspect-[1110/652] w-full'
              />
            ) : (
              <>
                <GhostImage
                  value={content.imageUrl}
                  onUpload={handleImage}
                  readOnly={readOnly}
                  alt={content.title}
                  className='aspect-[1110/652] w-full'
                />
                <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                  <span className='flex size-[114px] items-center justify-center rounded-full bg-white/95 shadow-lg'>
                    <SteelIcon
                      icon={PlayIcon}
                      size={32}
                      color={MOBILE_APP_COLORS.red}
                    />
                  </span>
                </div>
              </>
            )}
          </div>

          {!readOnly ? (
            content.videoUrl ? (
              <button
                type='button'
                onClick={() => onChange?.({ ...content, videoUrl: undefined })}
                className='mt-3 text-[#161c2d]/50 text-xs underline'
              >
                Remover vídeo
              </button>
            ) : (
              <div className='mt-3'>
                <GhostVideo
                  value={content.videoUrl}
                  onUpload={handleVideo}
                  readOnly={readOnly}
                  className='inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs'
                />
              </div>
            )
          ) : null}
        </div>
      </section>
    )
  }

  if (variant === 'numbered') {
    return (
      <section className='bg-white px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
        <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[#161c2d] text-[36px] leading-tight tracking-[-1.8px] sm:text-[48px]'
          />
          {content.subtitle || !readOnly ? (
            <GhostTextarea
              value={content.subtitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, subtitle: v || undefined })
              }
              placeholder='Descrição de apoio'
              readOnly={readOnly}
              as='p'
              className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
            />
          ) : null}
        </div>

        <div className='relative mx-auto grid max-w-5xl grid-cols-1 gap-x-8 gap-y-12 sm:grid-cols-3'>
          <div
            aria-hidden
            className='-translate-y-1/2 absolute top-[36px] right-[16.5%] left-[16.5%] hidden border-[#161c2d]/15 border-t border-dashed sm:block'
          />
          {content.items.map((item, index) => {
            const color = NUMBER_COLORS[index % NUMBER_COLORS.length]
            return (
              <div
                key={index}
                className='group/item relative flex flex-col items-center gap-4 text-center'
              >
                {!readOnly ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                    aria-label='Remover passo'
                    onClick={() => removeItem(index)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                  </Button>
                ) : null}
                <span
                  className='relative z-10 flex size-[73px] items-center justify-center rounded-full font-bold text-[36px] text-white tracking-[-1.2px]'
                  style={{ backgroundColor: color }}
                >
                  {index + 1}
                </span>
                <GhostInput
                  as='h3'
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Título do passo'
                  readOnly={readOnly}
                  className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                />
                <GhostTextarea
                  value={item.description}
                  onCommit={(v) => updateItem(index, { description: v })}
                  placeholder='Descrição do passo'
                  readOnly={readOnly}
                  as='p'
                  className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
                />
              </div>
            )
          })}
        </div>

        {!readOnly ? (
          <div className='mx-auto mt-8 flex max-w-5xl justify-center'>
            <button
              type='button'
              onClick={addItem}
              className='flex items-center justify-center gap-1 rounded-xl border border-dashed px-6 py-3 text-muted-foreground text-sm hover:bg-muted/40'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar passo
            </button>
          </div>
        ) : null}
      </section>
    )
  }

  // variant === 'showcase'
  return (
    <section className='bg-white px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.title}
          className='mx-auto aspect-[3/4] w-full max-w-md rounded-[10px] object-contain'
        />

        <div className='flex flex-col gap-8'>
          <div className='flex flex-col gap-4'>
            <GhostInput
              as='h2'
              value={content.title}
              onCommit={(v) => onChange?.({ ...content, title: v })}
              placeholder='Título da seção'
              readOnly={readOnly}
              className='text-balance font-bold text-[#161c2d] text-[32px] leading-tight tracking-[-1.5px] sm:text-[42px]'
            />
            {content.subtitle || !readOnly ? (
              <GhostTextarea
                value={content.subtitle ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, subtitle: v || undefined })
                }
                placeholder='Descrição de apoio'
                readOnly={readOnly}
                as='p'
                className='text-[#161c2d]/70 text-[19px] leading-[1.7]'
              />
            ) : null}
          </div>

          <div className='flex flex-col gap-8'>
            {content.items.map((item, index) => (
              <div
                key={index}
                className='group/item relative flex flex-col gap-2'
              >
                {!readOnly ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon-xs'
                    className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                    aria-label='Remover item'
                    onClick={() => removeItem(index)}
                  >
                    <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                  </Button>
                ) : null}
                <GhostInput
                  as='h3'
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Título'
                  readOnly={readOnly}
                  className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                />
                <GhostTextarea
                  value={item.description}
                  onCommit={(v) => updateItem(index, { description: v })}
                  placeholder='Descrição'
                  readOnly={readOnly}
                  as='p'
                  className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
                />
              </div>
            ))}
            {!readOnly ? (
              <button
                type='button'
                onClick={addItem}
                className={cn(
                  'flex min-h-16 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40',
                )}
              >
                <SteelIcon icon={Add01Icon} strokeWidth={2} />
                Adicionar item
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
