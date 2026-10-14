'use client'

import { ArrowRight01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type AboutContent = Extract<CrmLandingPageSectionContent, { type: 'ABOUT' }>

const BASE = '/landing-page-templates/ecommerce'

export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Track your progress with our advanced site.',
    description:
      'We share common trends and strategies for improving your rental income and making sure you stay in high demand.',
    imageUrl: `${BASE}/content-photo-main.png`,
    imageUrls: [`${BASE}/content-photo-float.png`],
  }
}

/**
 * Mapeia a seção "Content" do Figma (foto + texto + CTA num bloco roxo
 * full-bleed). O schema de ABOUT não tem campo de CTA (só HERO/FEATURES/
 * FOOTER têm) — the "Start shopping" link keeps its label and destination
 * in the section's `texts`/`hrefs` overrides (slot `cta`) instead.
 */
export function EcommerceAbout({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<AboutContent>) {
  async function handleImage(index: number | null, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    if (index === null) {
      onChange?.({ ...content, imageUrl: res.data.url })
      return
    }
    const imageUrls = [...content.imageUrls]
    imageUrls[index] = res.data.url
    onChange?.({ ...content, imageUrls })
  }

  const [floatImage] = content.imageUrls

  return (
    <section className='px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 rounded-[10px] bg-[#473bf0] p-8 sm:p-12 lg:grid-cols-2 lg:p-20'>
        <div className='relative mx-auto w-full max-w-sm'>
          <GhostImage
            value={content.imageUrl}
            onUpload={(file) => handleImage(null, file)}
            readOnly={readOnly}
            alt={content.title}
            className='aspect-[401/482] w-full rounded-[8px] object-cover shadow-[0px_42px_44px_-10px_rgba(1,23,48,0.12)]'
          />
          {floatImage || !readOnly ? (
            <GhostImage
              value={floatImage}
              onUpload={(file) => handleImage(0, file)}
              readOnly={readOnly}
              alt=''
              className='-rotate-7 absolute bottom-[-8%] left-[35%] aspect-square w-[45%] rounded-[10px] bg-white object-contain p-3 shadow-[0px_42px_44px_-10px_rgba(1,23,48,0.12)]'
            />
          ) : null}
        </div>

        <div className='flex flex-col gap-6'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[28px] text-white leading-tight tracking-[-1px] sm:text-[36px]'
          />

          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='max-w-md text-[19px] text-white/65 leading-[1.7]'
          />

          <GhostLink
            href={hrefOf(content, 'cta', '#produtos')}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            className='inline-flex w-fit items-center gap-2 font-bold text-[17px] text-white tracking-[-0.6px]'
          >
            <GhostInput
              value={textOf(content, 'cta', 'Start shopping')}
              onCommit={(v) => onChange?.(withText(content, 'cta', v))}
              placeholder='Texto do botão'
              readOnly={readOnly}
              className='field-sizing-content text-inherit'
            />
            <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={16} />
          </GhostLink>
        </div>
      </div>
    </section>
  )
}
