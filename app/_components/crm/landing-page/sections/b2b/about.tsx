'use client'

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

const BASE = '/landing-page-templates/b2b'

// The Figma "Content 01" frame has a 3-number mini list next to the copy.
// ABOUT has no typed field for it, so these are the defaults of the
// `fact.<i>.value` / `fact.<i>.label` text overrides.
const FACTS = [
  {
    value: '1M+',
    label: 'Customers visit Albino every month to get their service done.',
  },
  {
    value: '92%',
    label: 'Satisfaction rate comes from our awesome customers.',
  },
  {
    value: '4.9/5.0',
    label: 'Average customer ratings we have got all over internet.',
  },
]

export function aboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Experienced experts are giving advices.',
    description:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page.',
    imageUrl: `${BASE}/content01-photo.png`,
    imageUrls: [],
  }
}

export function B2bAbout({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<AboutContent>) {
  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, imageUrl: res.data.url })
  }

  return (
    <section className='bg-white px-6 py-16 sm:px-10 sm:py-24 lg:px-[123px]'>
      <div className='mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_auto_1fr] lg:gap-16'>
        <div className='flex flex-col gap-6'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[32px] sm:leading-[44px]'
          />
          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='max-w-sm text-[#161c2d]/70 text-[17px] leading-[1.7] sm:text-[19px]'
          />
          <GhostLink
            href={hrefOf(content, 'cta', '#footer')}
            onHrefChange={(v) => onChange?.(withHref(content, 'cta', v))}
            readOnly={readOnly}
            data-cta
            className='inline-flex w-fit items-center justify-center rounded-lg bg-[#473bf0] px-6 py-4 font-bold text-[17px] text-white tracking-[-0.6px] transition-opacity hover:opacity-90'
          >
            <GhostInput
              value={textOf(content, 'cta', 'Learn how we work')}
              onCommit={(v) => onChange?.(withText(content, 'cta', v))}
              placeholder='Texto do botão'
              readOnly={readOnly}
              className='text-inherit'
            />
          </GhostLink>
        </div>

        <GhostImage
          value={content.imageUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.title}
          className='aspect-[308/419] w-full max-w-[308px] rounded-[8px] object-cover lg:mx-0'
        />

        <div className='flex flex-col gap-8'>
          {FACTS.map((fact, index) => (
            <div key={index} className='flex flex-col gap-2'>
              <GhostInput
                value={textOf(content, `fact.${index}.value`, fact.value)}
                onCommit={(v) =>
                  onChange?.(withText(content, `fact.${index}.value`, v))
                }
                placeholder='0'
                readOnly={readOnly}
                className='font-bold text-[#161c2d] text-[32px] tracking-[-1.2px]'
              />
              <GhostTextarea
                as='span'
                value={textOf(content, `fact.${index}.label`, fact.label)}
                onCommit={(v) =>
                  onChange?.(withText(content, `fact.${index}.label`, v))
                }
                placeholder='Descrição da métrica'
                readOnly={readOnly}
                className='max-w-xs text-[#161c2d]/70 text-[19px] leading-[1.7]'
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
