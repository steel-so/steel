'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type StepsContent = Extract<CrmLandingPageSectionContent, { type: 'STEPS' }>

const CHECK_ICON = '/landing-page-templates/coworking/check-icon.svg'

/**
 * Mapeia a metade esquerda de "Content 02" (título + lista de 2 benefícios
 * com ícone de check) pro tipo STEPS — o frame original divide "Content 02"
 * em duas colunas (esta lista + um accordion de FAQ); aqui viram duas seções
 * independentes no array (STEPS + FAQ), ambas mantendo o fundo escuro pra
 * preservar a leitura visual do bloco original.
 */
export function stepsDefaultContent(): StepsContent {
  return {
    type: 'STEPS',
    title: 'Estamos sempre aqui para apoiar você.',
    subtitle:
      'Compartilhamos tendências e estratégias para criar e aumentar a sua receita com locação.',
    items: [
      {
        title: 'Locais Sem Barulho',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código.',
      },
      {
        title: 'Suporte 24 Horas, 7 Dias por Semana',
        description:
          'Com vários blocos prontos, você monta sua página sem escrever código.',
      },
    ],
  }
}

export function CoworkingSteps({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<StepsContent>) {
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
      items: [...content.items, { title: 'Novo benefício', description: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='bg-[#161c2d] px-6 pt-20 pb-10 sm:px-10 lg:px-[123px]'>
      <div className='mx-auto flex max-w-xl flex-col gap-8'>
        <div className='flex flex-col gap-4'>
          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[36px] text-white leading-tight tracking-[-1.8px] sm:text-[48px] sm:leading-[58px]'
          />
          {content.subtitle || !readOnly ? (
            <GhostTextarea
              value={content.subtitle ?? ''}
              onCommit={(v) =>
                onChange?.({ ...content, subtitle: v || undefined })
              }
              placeholder='Subtítulo'
              readOnly={readOnly}
              as='p'
              className='text-[19px] text-white/65 leading-[1.7]'
            />
          ) : null}
        </div>

        <div className='flex flex-col gap-6'>
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
                  className='absolute top-0 right-0 text-white opacity-0 group-hover/item:opacity-100'
                  aria-label='Remover benefício'
                  onClick={() => removeItem(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}
              <img
                src={CHECK_ICON}
                alt=''
                aria-hidden
                className='mt-1 h-[30px] w-[30px] shrink-0'
              />
              <div className='flex flex-col gap-1'>
                <GhostInput
                  as='h3'
                  value={item.title}
                  onCommit={(v) => updateItem(index, { title: v })}
                  placeholder='Título'
                  readOnly={readOnly}
                  className='font-bold text-[21px] text-white tracking-[-0.5px]'
                />
                <GhostTextarea
                  value={item.description}
                  onCommit={(v) => updateItem(index, { description: v })}
                  placeholder='Descrição'
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
              className='flex min-h-16 items-center justify-center gap-1 rounded-xl border border-white/20 border-dashed text-sm text-white/60 hover:bg-white/5'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} />
              Adicionar benefício
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
