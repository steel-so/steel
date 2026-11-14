'use client'

import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import { notify } from '@/lib/notify'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import { MOBILE_APP_NAVY_GRADIENT } from '@/src/lib/landing-page-templates/mobile-app/colors'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

const BASE = '/landing-page-templates/mobile-app'

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Uau! Nem acredito que ganhei uma página nova depois de usar o Ômega. Foi superfácil de editar e publicar.',
    authorName: 'Isaac Olson',
    avatarUrl: `${BASE}/testimonial-avatar-1.png`,
    style: 'default',
  }
}

export function testimonialSecondDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Simplesmente o melhor, bem acima dos concorrentes. Recomendo para iniciantes e para usuários avançados que querem resultado.',
    authorName: 'Barry Young',
    avatarUrl: `${BASE}/testimonial-avatar-2.png`,
    style: 'default',
  }
}

export function testimonialThirdDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Leitura obrigatória para quem quer ser Designer de Produto ou de Interação.',
    authorName: 'Esther Allison',
    avatarUrl: `${BASE}/testimonial-avatar-3.png`,
    style: 'default',
  }
}

/**
 * No Figma (node 0:611) os 3 cards ficam empilhados sobre o mesmo fundo
 * escuro da seção Features (0:558), formando um único bloco visual. Como
 * cada TESTIMONIAL é uma seção independente aqui, cada card recebe o mesmo
 * gradiente escuro — empilhados na mesma ordem do template, a costura
 * entre eles fica praticamente invisível, preservando a leitura de bloco
 * único do design de referência.
 */
export function MobileAppTestimonial({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<TestimonialContent>) {
  async function handleImage(file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    onChange?.({ ...content, avatarUrl: res.data.url })
  }

  if (content.style === 'spotlight') {
    return (
      <section
        style={{ backgroundImage: MOBILE_APP_NAVY_GRADIENT }}
        className='px-6 py-20 text-center sm:px-10 sm:py-28'
      >
        <div className='mx-auto flex max-w-2xl flex-col items-center gap-6'>
          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='text-balance font-bold text-[28px] text-white leading-[1.4] sm:text-[36px]'
          />

          <GhostImage
            value={content.avatarUrl}
            onUpload={handleImage}
            readOnly={readOnly}
            alt={content.authorName}
            className='mt-2 size-[76px] rounded-full object-cover'
          />

          <div className='flex flex-col items-center gap-1'>
            <GhostInput
              value={content.authorName}
              onCommit={(v) => onChange?.({ ...content, authorName: v })}
              placeholder='Nome'
              readOnly={readOnly}
              className='font-bold text-[17px] text-white'
            />
            {content.authorRole || !readOnly ? (
              <GhostInput
                value={content.authorRole ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, authorRole: v || undefined })
                }
                placeholder='Cargo/empresa'
                readOnly={readOnly}
                className='text-[15px] text-white/65'
              />
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      style={{ backgroundImage: MOBILE_APP_NAVY_GRADIENT }}
      className='px-6 py-6 sm:px-10 lg:px-[123px]'
    >
      <div className='mx-auto flex max-w-3xl flex-col items-start gap-6 rounded-xl border border-white/15 bg-white p-8 sm:flex-row sm:items-center sm:p-10'>
        <GhostImage
          value={content.avatarUrl}
          onUpload={handleImage}
          readOnly={readOnly}
          alt={content.authorName}
          className='size-[111px] shrink-0 rounded-full object-cover'
        />

        <div className='flex flex-col gap-3'>
          <GhostTextarea
            value={content.quote}
            onCommit={(v) => onChange?.({ ...content, quote: v })}
            placeholder='Depoimento'
            readOnly={readOnly}
            as='p'
            className='text-[#161c2d] text-[21px] leading-[1.5] tracking-[-0.5px]'
          />

          <div className='flex items-center gap-1 text-[17px]'>
            <GhostInput
              value={content.authorName}
              onCommit={(v) => onChange?.({ ...content, authorName: v })}
              placeholder='Nome'
              readOnly={readOnly}
              className='text-[#161c2d]/70'
            />
            {content.authorRole || !readOnly ? (
              <>
                <span className='text-[#161c2d]/50'>·</span>
                <GhostInput
                  value={content.authorRole ?? ''}
                  onCommit={(v) =>
                    onChange?.({ ...content, authorRole: v || undefined })
                  }
                  placeholder='Cargo/empresa'
                  readOnly={readOnly}
                  className='text-[#161c2d]/50'
                />
              </>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
