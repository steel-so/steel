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

const BASE = '/landing-page-templates/web-application'

/**
 * Mapeia o bloco "Content 01" do frame Figma (imagem única — mockup de
 * laptop com dashboard). "Content 03" (colagem de 4 fotos) usa o mesmo tipo
 * ABOUT — só entra 1x no registry por tipo — reaproveitando este mesmo
 * componente com `imageUrls` preenchido (ver `aboutCollageDefaultContent`
 * exportado abaixo, usado no template pra montar a 3ª seção).
 */
export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Track your progress with our advanced site.',
    description:
      'We share common trends and strategies for improving your rental income and making sure you stay in high demand.',
    imageUrl: `${BASE}/content-01-laptop.png`,
    imageUrls: [],
  }
}

export function aboutCollageDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Make your customers happy by giving services.',
    description:
      'We share common trends and strategies for improving your rental income and making sure you stay in high demand.',
    imageUrl: `${BASE}/content-03-photo-1.png`,
    imageUrls: [
      `${BASE}/content-03-photo-2.png`,
      `${BASE}/content-03-photo-3.png`,
    ],
  }
}

/**
 * O schema ABOUT (`src/schemas/crm-landing-page-section.schema.ts`) não tem
 * campo de CTA (só eyebrow/title/description/imageUrl/imageUrls) — o Figma
 * tem um link "Start a free trial →" embaixo de cada bloco Content. Texto e
 * destino ficam nos overrides `texts.cta`/`hrefs.cta`; estes são os padrões.
 */
const CTA_LABEL = 'Start a free trial'
const CTA_HREF = '#footer'

export function WebApplicationAbout({
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

  const [collage1, collage2] = content.imageUrls
  const hasCollage = content.imageUrls.length > 0 || !readOnly

  return (
    <section className='bg-white px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        {hasCollage ? (
          <div className='grid grid-cols-2 gap-4'>
            <GhostImage
              value={content.imageUrl}
              onUpload={(file) => handleImage(null, file)}
              readOnly={readOnly}
              alt={content.title}
              className='aspect-[212/206] w-full rounded-[8px] object-cover'
            />
            <GhostImage
              value={collage1}
              onUpload={(file) => handleImage(0, file)}
              readOnly={readOnly}
              alt=''
              className='mt-10 aspect-[212/255] w-full rounded-[8px] object-cover'
            />
            <GhostImage
              value={collage2}
              onUpload={(file) => handleImage(1, file)}
              readOnly={readOnly}
              alt=''
              className='aspect-[212/206] w-full rounded-[8px] object-cover'
            />
          </div>
        ) : (
          <GhostImage
            value={content.imageUrl}
            onUpload={(file) => handleImage(null, file)}
            readOnly={readOnly}
            alt={content.title}
            className='aspect-[600/424] w-full rounded-[8px] object-cover shadow-[0px_42px_44px_-10px_rgba(1,23,48,0.12)]'
          />
        )}

        <div className='flex flex-col gap-5'>
          {content.eyebrow || !readOnly ? (
            <GhostInput
              value={content.eyebrow ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, eyebrow: v || undefined })
              }
              placeholder='Texto de destaque'
              readOnly={readOnly}
              className='font-bold text-[#473bf0] text-[13px] uppercase tracking-[1.6px]'
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
          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='max-w-md text-[#161c2d]/70 text-[19px] leading-[1.7]'
          />
          <GhostLink
            href={hrefOf(content, 'cta', CTA_HREF)}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            data-cta
            className='inline-flex items-center gap-2 font-bold text-[#473bf0] text-[21px] tracking-[-1.2px] hover:opacity-80'
          >
            <GhostInput
              value={textOf(content, 'cta', CTA_LABEL)}
              onCommit={(v) => onChange?.(withText(content, 'cta', v))}
              placeholder='Texto do link'
              readOnly={readOnly}
              className='text-inherit'
            />
            <SteelIcon icon={ArrowRight01Icon} strokeWidth={2.5} size={18} />
          </GhostLink>
        </div>
      </div>
    </section>
  )
}
