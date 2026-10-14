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

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const BASE = '/landing-page-templates/web-application'

/**
 * Mapeia o bloco "Content 02" do frame Figma (texto à esquerda, imagem à
 * direita — o inverso de Content 01/03, que usam ABOUT). O tipo STEPS cabe
 * bem aqui porque o schema já tem eyebrow/title/subtitle/imageUrl com
 * `items` opcional — deixamos `items` vazio, já que este bloco não é uma
 * lista numerada no Figma (é so texto + imagem, ver instruções da task).
 */
export function stepsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Understand your visitors fast. Take quick actions.',
    subtitle:
      'We share common trends and strategies for improving your rental income and making sure you stay in high demand.',
    imageUrl: `${BASE}/content-02-front.png`,
    items: [],
  }
}

// Defaults for the "Start a free trial →" link — STEPS has no CTA field, so
// the label and target live in the `texts.cta`/`hrefs.cta` overrides.
const CTA_LABEL = 'Start a free trial'
const CTA_HREF = '#footer'

export function WebApplicationSteps({
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

  return (
    <section className='bg-[#ecf2f7] px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-16 lg:grid-cols-2'>
        <div className='order-2 flex flex-col gap-5 lg:order-1'>
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
          {content.subtitle || !readOnly ? (
            <GhostTextarea
              value={content.subtitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, subtitle: v || undefined })
              }
              placeholder='Descrição'
              readOnly={readOnly}
              as='p'
              className='max-w-md text-[#161c2d]/70 text-[19px] leading-[1.7]'
            />
          ) : null}
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

        <div className='order-1 lg:order-2'>
          <GhostImage
            value={content.imageUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.title}
            className='aspect-[394/564] w-full max-w-[394px] rounded-[8px] object-cover shadow-[0px_31px_34px_-20px_rgba(0,0,0,0.09)] lg:ml-auto'
          />
        </div>
      </div>
    </section>
  )
}
