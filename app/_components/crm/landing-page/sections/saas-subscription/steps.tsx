'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const BASE = '/landing-page-templates/saas-subscription'

/**
 * "Content 01" do Figma (texto + imagem + CTA, sem lista numerada) — `items`
 * vazio. STEPS não tem campo de CTA próprio, então o botão abaixo usa os
 * overrides `texts.cta`/`hrefs.cta` (padrão: mesmo texto/link do Hero).
 */
export function stepsGettingStartedDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Getting started with Albino is easier than ever',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page so quickly with Albino.',
    imageUrl: `${BASE}/steps1-user-1.png`,
    items: [],
  }
}

/** "Content 02" do Figma (texto + lista numerada + imagem). */
export function stepsManageProjectsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Manage your projects fast',
    subtitle:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    imageUrl: `${BASE}/steps2-event.png`,
    items: [
      {
        title: 'Create a project',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
      {
        title: 'Assign related people',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
      {
        title: 'Make it done on-time',
        description:
          'With lots of unique blocks, you can easily build a page without coding.',
      },
    ],
  }
}

export function SaasSubscriptionSteps({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<StepsContent>) {
  const hasItems = content.items.length > 0

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

  const imageBlock = (
    <div className='relative mx-auto aspect-square w-full max-w-[420px]'>
      {hasItems ? (
        <>
          <img
            src={`${BASE}/steps2-calendar.png`}
            alt=''
            aria-hidden
            className='absolute top-[7%] right-0 w-1/2 opacity-50'
          />
          <img
            src={`${BASE}/steps2-card.png`}
            alt=''
            aria-hidden
            className='absolute top-0 left-0 w-[63%] opacity-85'
          />
        </>
      ) : (
        <>
          <img
            src={`${BASE}/steps1-card.png`}
            alt=''
            aria-hidden
            className='absolute top-0 left-0 w-[60%] opacity-40'
          />
          <img
            src={`${BASE}/steps1-user-3.png`}
            alt=''
            aria-hidden
            className='absolute top-0 right-0 w-[40%] opacity-15'
          />
          <img
            src={`${BASE}/steps1-user-2.png`}
            alt=''
            aria-hidden
            className='absolute bottom-0 right-[5%] w-1/2 opacity-60'
          />
        </>
      )}
      <GhostImage
        value={content.imageUrl}
        onUpload={handleImage}
        readOnly={readOnly}
        alt={content.title}
        className={cn(
          'absolute overflow-hidden rounded-[10px] shadow-[0px_32px_54px_0px_rgba(15,14,35,0.19)]',
          hasItems
            ? 'right-0 bottom-0 w-[63%]'
            : 'top-[18%] left-[22%] w-[72%]',
        )}
      />
    </div>
  )

  const textBlock = (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-4'>
        {content.eyebrow || !readOnly ? (
          <GhostInput
            value={content.eyebrow ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, eyebrow: v || undefined })
            }
            placeholder='Texto de destaque'
            readOnly={readOnly}
            className='font-bold text-[#68d585] text-[13px] uppercase tracking-[1.6px]'
          />
        ) : null}
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
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
            className='max-w-md text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
        ) : null}
      </div>

      {hasItems ? (
        <div className='flex flex-col gap-8'>
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
              <span className='flex size-11 shrink-0 items-center justify-center rounded-full bg-[#473bf0]/10 font-medium text-[#473bf0] text-[17px]'>
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
              className='flex min-h-16 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar passo
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <GhostLink
            href={hrefOf(content, 'cta', '#footer')}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            data-cta
            className='inline-flex w-fit items-center justify-center rounded-lg bg-[#473bf0] px-8 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
          >
            <GhostInput
              value={textOf(content, 'cta', 'Get started for free')}
              onCommit={(v) => onChange?.(withText(content, 'cta', v))}
              placeholder='Texto do botão'
              readOnly={readOnly}
              className='text-inherit'
            />
          </GhostLink>
          {!readOnly ? (
            <button
              type='button'
              onClick={addItem}
              className='flex min-h-12 items-center justify-center gap-1 rounded-xl border border-dashed text-muted-foreground text-sm hover:bg-muted/40'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar lista de passos
            </button>
          ) : null}
        </>
      )}
    </div>
  )

  return (
    <section className='bg-[#f4f7fa] px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        {hasItems ? (
          <>
            {imageBlock}
            {textBlock}
          </>
        ) : (
          <>
            {textBlock}
            {imageBlock}
          </>
        )}
      </div>
    </section>
  )
}
