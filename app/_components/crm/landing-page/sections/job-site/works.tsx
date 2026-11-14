'use client'

import { Add01Icon, Delete02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostImage } from '@/components/ui/ghost-image'
import { GhostInput } from '@/components/ui/ghost-input'
import { SimpleCarousel } from '@/components/ui/simple-carousel'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { uploadCrmLandingPageImage } from '@/src/hooks/use-crm-landing-page'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type { LandingPageSectionProps } from '../types'

type WorksContent = Extract<CrmLandingPageSectionContent, { type: 'WORKS' }>

const BASE = '/landing-page-templates/job-site'

// Tags de vaga reconhecidas — quando `category` bate com uma delas, o card
// renderiza no formato "listagem de vaga" (avatar + badge colorido). Fora
// isso, cai no formato "card de notícia" (foto + legenda) — é assim que
// este único componente WORKS serve tanto "Featured jobs" quanto "News that
// helps" no frame Figma, sem precisar de um campo extra no schema.
const JOB_TAG_COLORS: Record<string, string> = {
  'Full-time': 'text-[#68d585]',
  'Part-time': 'text-[#f64b4b]',
  Remote: 'text-[#473bf0]',
  Contract: 'text-[#473bf0]',
  Internship: 'text-[#68d585]',
  'Tempo integral': 'text-[#68d585]',
  'Meio período': 'text-[#f64b4b]',
  Remoto: 'text-[#473bf0]',
  Contrato: 'text-[#473bf0]',
  Estágio: 'text-[#68d585]',
}

export function worksDefaultContent(): WorksContent {
  return {
    type: 'WORKS',
    title: 'Vagas em destaque',
    subtitle:
      'Com blocos prontos, você monta sua página facilmente, sem escrever código.',
    items: [
      {
        title: 'Engenheiro(a) de Software Sênior — Dorfus, São Paulo, SP',
        category: 'Tempo integral',
        imageUrl: `${BASE}/job-logo-dorfus.png`,
      },
      {
        title: 'Designer de Produto — Coworks, Curitiba, PR',
        category: 'Remoto',
        imageUrl: `${BASE}/job-logo-coworks.svg`,
      },
      {
        title: 'Designer de UX — Askimat, Florianópolis, SC',
        category: 'Tempo integral',
        imageUrl: `${BASE}/job-logo-askimat.png`,
      },
      {
        title: 'Desenvolvedor(a) Web Full-stack — Greener, Belo Horizonte, MG',
        category: 'Meio período',
        imageUrl: `${BASE}/job-logo-greener.svg`,
      },
    ],
  }
}

export function newsDefaultContent(): WorksContent {
  return {
    type: 'WORKS',
    title: 'Notícias que ajudam',
    subtitle:
      'Com blocos prontos, você monta sua página facilmente, sem escrever código. Crie a sua próxima página.',
    items: [
      {
        title: 'Como conquistar a vaga que você quer em 5 passos.',
        category: 'Carreira',
        imageUrl: `${BASE}/news-1.png`,
      },
      {
        title: '10 formas de reduzir o desânimo no trabalho de escritório.',
        category: 'Estilo de vida',
        imageUrl: `${BASE}/news-2.png`,
      },
      {
        title: 'Por que trabalhar em equipe até nos projetos pequenos.',
        category: 'Carreira',
        imageUrl: `${BASE}/news-3.png`,
      },
    ],
  }
}

export function JobSiteWorks({
  content,
  onChange,
  workspaceId,
  readOnly,
}: LandingPageSectionProps<WorksContent>) {
  function updateItem(
    index: number,
    patch: Partial<{ title: string; category: string; imageUrl?: string }>,
  ) {
    onChange?.({
      ...content,
      items: content.items.map((it, i) =>
        i === index ? { ...it, ...patch } : it,
      ),
    })
  }

  async function handleImage(index: number, file: File) {
    const res = await uploadCrmLandingPageImage(workspaceId ?? '', file)
    if (!res.ok || !res.data) {
      notify.error(res.message ?? 'Não foi possível enviar a imagem.')
      return
    }
    updateItem(index, { imageUrl: res.data.url })
  }

  function addItem() {
    onChange?.({
      ...content,
      items: [...content.items, { title: 'Novo item', category: '' }],
    })
  }

  function removeItem(index: number) {
    onChange?.({
      ...content,
      items: content.items.filter((_, i) => i !== index),
    })
  }

  return (
    <section className='bg-white px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <div className='mx-auto mb-16 flex max-w-2xl flex-col items-center gap-4 text-center'>
        {content.subtitle || !readOnly ? (
          <GhostInput
            value={content.subtitle ?? ''}
            onCommit={(v) =>
              onChange?.({ ...content, subtitle: v || undefined })
            }
            placeholder='Descrição de apoio'
            readOnly={readOnly}
            className='text-[#161c2d]/70 text-[19px]'
          />
        ) : null}
        <GhostInput
          as='h2'
          value={content.title}
          onCommit={(v) => onChange?.({ ...content, title: v })}
          placeholder='Título da seção'
          readOnly={readOnly}
          className='text-balance font-bold text-[#161c2d] text-[28px] leading-tight tracking-[-1px] sm:text-[36px]'
        />
      </div>

      <SimpleCarousel className='mx-auto max-w-6xl'>
        {content.items.map((item, index) => {
          const tagColorClass = JOB_TAG_COLORS[item.category]
          const isJobCard = tagColorClass !== undefined
          return (
            <div
              key={index}
              className='group/item relative w-[320px] shrink-0 snap-start sm:w-[360px]'
            >
              {!readOnly ? (
                <Button
                  type='button'
                  variant='secondary'
                  size='icon-xs'
                  className='absolute top-3 right-3 z-10 opacity-0 group-hover/item:opacity-100'
                  aria-label='Remover item'
                  onClick={() => removeItem(index)}
                >
                  <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
                </Button>
              ) : null}

              {isJobCard ? (
                <div className='flex h-full flex-col gap-6 rounded-[10px] border border-[#e7e9ed] p-8 shadow-[0_34px_33px_-23px_rgba(22,28,45,0.13)]'>
                  <GhostInput
                    value={item.category}
                    onCommit={(v) => updateItem(index, { category: v })}
                    placeholder='Tipo de vaga'
                    readOnly={readOnly}
                    className={cn(
                      'font-bold text-[13px] uppercase tracking-[1.6px]',
                      tagColorClass,
                    )}
                  />
                  <GhostInput
                    as='h3'
                    value={item.title}
                    onCommit={(v) => updateItem(index, { title: v })}
                    placeholder='Cargo, empresa e localização'
                    readOnly={readOnly}
                    className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                  />
                  <div className='mt-auto flex items-center gap-3'>
                    <GhostImage
                      value={item.imageUrl}
                      onUpload={(file) => handleImage(index, file)}
                      readOnly={readOnly}
                      alt=''
                      className='size-8 rounded-full'
                    />
                  </div>
                </div>
              ) : (
                <div className='flex h-full flex-col gap-4 rounded-[10px] border border-[#e7e9ed] shadow-[0_34px_33px_-23px_rgba(22,28,45,0.13)]'>
                  <GhostImage
                    value={item.imageUrl}
                    onUpload={(file) => handleImage(index, file)}
                    readOnly={readOnly}
                    alt={item.title}
                    className='aspect-[350/301] w-full rounded-t-[10px]'
                  />
                  <div className='flex flex-col gap-2 px-8 pb-8'>
                    <GhostInput
                      value={item.category}
                      onCommit={(v) => updateItem(index, { category: v })}
                      placeholder='Categoria'
                      readOnly={readOnly}
                      className='text-[#161c2d]/70 text-[15px]'
                    />
                    <GhostInput
                      as='h3'
                      value={item.title}
                      onCommit={(v) => updateItem(index, { title: v })}
                      placeholder='Título da notícia'
                      readOnly={readOnly}
                      className='font-bold text-[#161c2d] text-[21px] tracking-[-0.5px]'
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {!readOnly ? (
          <button
            type='button'
            onClick={addItem}
            className={cn(
              'flex min-h-52 w-[320px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed text-muted-foreground text-sm hover:bg-muted/40 sm:w-[360px]',
            )}
          >
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar item
          </button>
        ) : null}
      </SimpleCarousel>
    </section>
  )
}
