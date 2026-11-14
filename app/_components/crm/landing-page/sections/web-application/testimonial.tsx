'use client'

import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type TestimonialContent = Extract<
  CrmLandingPageSectionContent,
  { type: 'TESTIMONIAL' }
>

export function testimonialDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Uau! Não acredito que ganhei uma landing page totalmente nova com o Omega. Foi super fácil de editar e publicar.',
    authorName: 'Diego Morata',
    authorRole: 'Desenvolvedor web',
    style: 'default',
  }
}

export function testimonialSecondDefaultContent(): TestimonialContent {
  return {
    type: 'TESTIMONIAL',
    quote:
      'Simplesmente o melhor. Superior a todos os outros. Eu recomendaria este produto para iniciantes e usuários avançados.',
    authorName: 'Franklin Hicks',
    authorRole: 'Profissional de marketing digital',
    style: 'default',
  }
}

/**
 * No Figma, os 2 depoimentos ficam lado a lado numa grade 2 colunas dentro
 * do MESMO frame "Testimonial". Como cada seção da página é seu próprio
 * bloco vertical (não há como 2 seções TESTIMONIAL independentes ocuparem
 * a mesma linha), cada instância aqui renderiza como card full-width —
 * a única diferença visual real do card individual (aspas grandes, negrito,
 * nome+cargo) foi preservada; o empilhamento vertical é a simplificação.
 */
export function WebApplicationTestimonial({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<TestimonialContent>) {
  return (
    <section className='bg-[#ecf2f7] px-6 pb-16 sm:px-10 sm:pb-24 lg:px-[123px]'>
      <div className='mx-auto flex max-w-2xl flex-col gap-4'>
        <span
          aria-hidden
          className='font-semibold text-[#473bf0] text-[64px] leading-[0.6]'
        >
          &ldquo;
        </span>
        <GhostTextarea
          value={content.quote}
          onCommit={(v) => onChange?.({ ...content, quote: v })}
          placeholder='Depoimento'
          readOnly={readOnly}
          as='p'
          className='font-bold text-[#161c2d] text-[24px] leading-[1.4] tracking-[-0.5px]'
        />
        <div className='flex items-center gap-1 text-[17px]'>
          <GhostInput
            value={content.authorName}
            onCommit={(v) => onChange?.({ ...content, authorName: v })}
            placeholder='Nome'
            readOnly={readOnly}
            className='font-bold text-[#161c2d]'
          />
          {content.authorRole || !readOnly ? (
            <>
              <span className='text-[#161c2d]/70'>·</span>
              <GhostInput
                value={content.authorRole ?? ''}
                onCommit={(v) =>
                  onChange?.({ ...content, authorRole: v || undefined })
                }
                placeholder='Cargo/empresa'
                readOnly={readOnly}
                className='text-[#161c2d]/70'
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
