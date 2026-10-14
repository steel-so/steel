'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostLink } from '@/components/ui/ghost-link'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { hrefOf, textOf, withHref, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type FaqContent = Extract<CrmLandingPageSectionContent, { type: 'FAQ' }>

const BADGE = '/landing-page-templates/saas-subscription/faq-question-badge.svg'

export function faqDefaultContent(): FaqContent {
  return {
    type: 'FAQ',
    title: 'Frequently Asked Questions',
    items: [
      {
        question: 'Can I use Albino for my clients?',
        answer:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
      },
      {
        question: 'Does it work with WordPress?',
        answer:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
      },
      {
        question: 'Do I get free updates?',
        answer:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
      },
      {
        question: 'Will you provide support?',
        answer:
          'With lots of unique blocks, you can easily build a page without coding. Build your next landing page. Integer ut Oberyn massa. Sed feugiat vitae turpis a porta.',
      },
    ],
  }
}

export function SaasSubscriptionFaq({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<FaqContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ question: string; answer: string }>,
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
      items: [...content.items, { question: 'Nova pergunta', answer: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='bg-[#161c2d] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-14 flex max-w-2xl flex-col items-center gap-4 text-center'>
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[28px] text-white leading-tight tracking-[-1px] sm:text-[36px] sm:leading-[48px]'
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
            className='text-[19px] text-white/65 leading-[1.7]'
          />
        ) : null}
      </div>

      <div className='mx-auto grid max-w-4xl grid-cols-1 gap-x-16 gap-y-12 sm:grid-cols-2'>
        {content.items.map((item, index) => (
          <div key={index} className='group/item relative flex gap-4'>
            {!readOnly ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-0 right-0 opacity-0 group-hover/item:opacity-100'
                aria-label='Remover pergunta'
                onClick={() => removeItem(index)}
              >
                <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
              </Button>
            ) : null}
            <img
              src={BADGE}
              alt=''
              aria-hidden
              className='mt-1 size-7 shrink-0'
            />
            <div className='flex flex-col gap-3'>
              <GhostInput
                as='h3'
                value={item.question}
                onCommit={(v) => updateItem(index, { question: v })}
                placeholder='Pergunta'
                readOnly={readOnly}
                className='font-bold text-[21px] text-white tracking-[-0.5px]'
              />
              <GhostTextarea
                value={item.answer}
                onCommit={(v) => updateItem(index, { answer: v })}
                placeholder='Resposta'
                readOnly={readOnly}
                as='p'
                className='text-[17px] text-white/65 leading-[1.7]'
              />
            </div>
          </div>
        ))}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className='flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/30 text-sm text-white/60 hover:bg-white/5'
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar pergunta
          </button>
        ) : null}
      </div>

      <p className='mt-16 text-center text-[17px] text-white'>
        <GhostInput
          value={textOf(content, 'support.prefix', 'Haven’t got your answer?')}
          onCommit={(v) => onChange?.(withText(content, 'support.prefix', v))}
          placeholder='Texto de apoio'
          readOnly={readOnly}
          className='field-sizing-content w-auto text-inherit'
        />{' '}
        <GhostLink
          href={hrefOf(content, 'support.link', '#footer')}
          onHrefChange={(v) => onChange?.(withHref(content, 'support.link', v))}
          readOnly={readOnly}
          className='text-[#68d585]'
        >
          <GhostInput
            value={textOf(content, 'support.link', 'Contact our support now')}
            onCommit={(v) => onChange?.(withText(content, 'support.link', v))}
            placeholder='Texto do link'
            readOnly={readOnly}
            className='field-sizing-content w-auto text-inherit'
          />
        </GhostLink>
      </p>
    </section>
  )
}
