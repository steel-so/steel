'use client'

import {
  Add01Icon,
  Delete02Icon,
  Notification03Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const DEFAULT_PHOTO = '/landing-page-templates/job-site/content-photo.png'

export function stepsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Find jobs with 3 easy steps',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    imageUrl: DEFAULT_PHOTO,
    items: [
      {
        title: 'Search for a job',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
      {
        title: 'Apply within our website',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
      {
        title: 'Get interview call',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
    ],
  }
}

export function JobSiteSteps({
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
    <section className='px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px]'
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
            className='text-balance text-[#161c2d]/70 text-[17px] sm:text-[19px]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-5xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        <div className='relative mx-auto w-full max-w-[425px]'>
          <div
            aria-hidden
            className='pointer-events-none absolute inset-6 -z-10 rounded-[10px] bg-[#68d585]/10'
          />
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='aspect-[425/571] w-full rounded-[10px]'
          />
          <div className='-bottom-6 absolute left-4 flex w-[85%] items-center gap-3 rounded-[10px] bg-[#161c2d] px-4 py-4 shadow-[0_62px_64px_-10px_rgba(1,23,48,0.25)]'>
            <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-[#68d585]'>
              <SteelIcon
                icon={Notification03Icon}
                strokeWidth={2}
                size={16}
                className='text-white'
              />
            </span>
            <div className='flex min-w-0 flex-1 flex-col'>
              <GhostInput
                value={textOf(content, 'notice.badge', 'New Invitation!')}
                onCommit={(v) =>
                  onChange?.(withText(content, 'notice.badge', v))
                }
                placeholder='Rótulo do aviso'
                readOnly={readOnly}
                className='text-[13px] text-white/70'
              />
              <GhostInput
                value={textOf(
                  content,
                  'notice.title',
                  'Interview invitation at Greener',
                )}
                onCommit={(v) =>
                  onChange?.(withText(content, 'notice.title', v))
                }
                placeholder='Texto do aviso'
                readOnly={readOnly}
                className='font-bold text-[15px] text-white'
              />
            </div>
          </div>
        </div>

        <div className='flex flex-col gap-10'>
          {content.items.map((item, index) => (
            <div key={index} className='group/item relative flex gap-5'>
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
              <span className='flex size-[43px] shrink-0 items-center justify-center rounded-full bg-[#473bf0] font-bold text-white'>
                {index + 1}
              </span>
              <div className='flex flex-col gap-1'>
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
            </div>
          ))}
          {!readOnly ? (
            <button
              type='button'
              onClick={addItem}
              className='flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
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
