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
import {
  uploadCrmLandingPageImage,
  uploadCrmLandingPageVideo,
} from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const VIDEO_PREVIEW =
  '/landing-page-templates/consultation/steps-video-preview.png'

export function consultationStepsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Por que escolher a gente?',
    subtitle:
      'Com vários blocos prontos, você monta sua página sem escrever código. Crie sua próxima landing page.',
    imageUrl: VIDEO_PREVIEW,
    items: [
      {
        title: 'Agendamento Fácil',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código.',
      },
      {
        title: 'Opinião Gratuita de Especialistas',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código.',
      },
      {
        title: 'Receba Seus Resultados',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código.',
      },
    ],
  }
}

/**
 * O frame "Content" do Figma dobra um preview de vídeo (imagem estática +
 * ícone de play sobreposto) com os 3 passos numerados numa única seção —
 * mapeado aqui pro tipo STEPS. Com `videoUrl` definido, o preview vira o
 * `<video>` real (autoplay/mudo/loop); sem ele, cai de volta pra
 * `imageUrl` com o ícone de play decorativo, como antes.
 */
export function ConsultationSteps({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<StepsContent>) {
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

  return (
    <section className='bg-[#f4f7fa] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1.2px] sm:text-[36px] sm:leading-[48px]'
        />
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Descrição de apoio'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[19px] leading-[1.7] tracking-[-0.2px]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-5xl grid-cols-1 items-center gap-12 lg:grid-cols-2'>
        <div className='relative mx-auto aspect-[541/419] w-full max-w-[541px] overflow-hidden rounded-[8px] shadow-[0_31px_34px_-20px_rgba(0,0,0,0.09)]'>
          {content.videoUrl ? (
            <GhostVideo
              value={content.videoUrl}
              onUpload={handleVideo}
              readOnly={readOnly}
              className='size-full object-cover'
            />
          ) : (
            <>
              <GhostImage
                value={content.imageUrl}
                onUpload={handleImage}
                readOnly={readOnly}
                alt={content.title}
                className='size-full object-cover'
              />
              <div
                aria-hidden
                className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 flex size-[92px] items-center justify-center rounded-full bg-white shadow-lg'
              >
                <SteelIcon
                  icon={PlayIcon}
                  size={22}
                  className='translate-x-0.5 text-[#68d585]'
                />
              </div>
            </>
          )}
          {!readOnly && !content.videoUrl ? (
            <div className='absolute right-2 bottom-2'>
              <GhostVideo
                onUpload={handleVideo}
                className='flex h-9 items-center gap-1 rounded-lg bg-black/60 px-3 text-white text-xs backdrop-blur-sm'
              />
            </div>
          ) : null}
          {!readOnly && content.videoUrl ? (
            <Button
              type='button'
              variant='secondary'
              size='icon-xs'
              className='absolute top-2 right-2 z-10'
              aria-label='Remover vídeo'
              onClick={() => onChange?.({ ...content, videoUrl: undefined })}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
            </Button>
          ) : null}
        </div>

        <div className='flex flex-col gap-10'>
          {content.items.map((item, index) => (
            <div
              key={index}
              className='group/item relative flex items-start gap-4'
            >
              {!readOnly ? (
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  className='-top-2 -right-2 absolute opacity-0 group-hover/item:opacity-100'
                  aria-label='Remover passo'
                  onClick={() => removeItem(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}
              <span className='flex size-[43px] shrink-0 items-center justify-center rounded-full bg-[#ece9fd] font-medium text-[#473bf0] text-[17px]'>
                {index + 1}
              </span>
              <div className='flex flex-col gap-2'>
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
                  placeholder='Descrição'
                  readOnly={readOnly}
                  as='p'
                  className='text-[#161c2d]/70 text-[17px] leading-[1.7]'
                />
              </div>
            </div>
          ))}
          {!readOnly ? (
            <button
              type='button'
              onClick={addItem}
              className='flex min-h-16 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-background'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar passo
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
