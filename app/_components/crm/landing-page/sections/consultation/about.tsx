'use client'

import {
  Add01Icon,
  Delete02Icon,
  Message01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { GhostInput } from '@/components/ui/ghost-input'
import { GhostTextarea } from '@/components/ui/ghost-textarea'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import { textOf, withText } from '../overrides'
import type { LandingPageSectionProps } from '../types'

type AboutContent = Extract<CrmLandingPageSectionContent, { type: 'ABOUT' }>
type Dropdown = NonNullable<AboutContent['dropdowns']>[number]

const PATTERN_BG =
  '/landing-page-templates/consultation/cta-form-bg-pattern.png'

export function consultationAboutDefaultContent(): AboutContent {
  return {
    type: 'ABOUT',
    title: 'Get a free consultancy from our expert right now!',
    description:
      'With lots of unique blocks, you can easily build a page without coding. Build your next landing page so quickly with Albino.',
    imageUrls: [],
    dropdowns: [
      {
        label: 'Which service do you need?',
        options: [
          'Digital Marketing',
          'Content Writing',
          'Graphic Design',
          'SEO for Business',
        ],
      },
    ],
  }
}

/**
 * Campo "Which service do you need?" do card de formulário — a única parte
 * do bloco "CTA Form" com backing real no schema (`AboutContentSchema.
 * dropdowns`). No preview público (`readOnly`) não há select interativo pra
 * mostrar (o card inteiro é decorativo, sem submissão), então só o texto do
 * rótulo é renderizado — mesma convenção dos campos Nome/Email/Telefone
 * logo acima, que também são decorativos/desabilitados. Em modo de edição
 * vira um editor completo de rótulo + opções, no mesmo padrão de
 * adicionar/remover do `crm-form-builder.tsx`.
 */
function DropdownField({
  dropdown,
  onLabelChange,
  onOptionChange,
  onAddOption,
  onRemoveOption,
  readOnly,
}: {
  dropdown: Dropdown
  onLabelChange: (label: string) => void
  onOptionChange: (index: number, value: string) => void
  onAddOption: () => void
  onRemoveOption: (index: number) => void
  readOnly?: boolean
}) {
  if (readOnly) {
    return (
      <div className='flex flex-col gap-2'>
        <span className='font-bold text-[#161c2d] text-[15px] tracking-[-0.1px]'>
          {dropdown.label}
        </span>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <GhostInput
        value={dropdown.label}
        onCommit={onLabelChange}
        placeholder='Pergunta do dropdown'
        className='font-bold text-[#161c2d] text-[15px] tracking-[-0.1px]'
      />
      <div className='flex flex-col gap-2 rounded-lg border border-[#e7e9ed] p-3'>
        {dropdown.options.map((option, index) => (
          <div key={index} className='flex items-center gap-1'>
            <GhostInput
              value={option}
              onCommit={(v) => onOptionChange(index, v)}
              placeholder='Opção'
              className='flex-1 text-[#161c2d] text-[15px] tracking-[-0.1px]'
            />
            <Button
              type='button'
              variant='ghost'
              size='icon-xs'
              aria-label='Remover opção'
              onClick={() => onRemoveOption(index)}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} size={12} />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='self-start'
          onClick={onAddOption}
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} size={12} />
          Adicionar opção
        </Button>
      </div>
    </div>
  )
}

/**
 * Mapeia o bloco "CTA Form" do Figma (painel escuro + card de formulário
 * com Nome/Email/Telefone/Serviço) pro tipo ABOUT — mais próximo em forma
 * (título + descrição), mas sem campos de CTA/formulário no schema. O card
 * de formulário e o botão "Get Free Consultancy" ficam decorativos/fixos
 * no componente (sem submissão real — nenhum outro template tem backend de
 * formulário funcional); só o dropdown de serviço tem edição real, via
 * `AboutContentSchema.dropdowns`.
 */
const FORM_FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'i.e. John Doe' },
  { key: 'email', label: 'Email', placeholder: 'i.e. john@mail.com' },
  { key: 'phone', label: 'Phone', placeholder: 'i.e. 123-456-7890' },
] as const

const FIELD_LABEL_CLASS =
  'font-bold text-[#161c2d] text-[15px] tracking-[-0.1px]'
const FIELD_BOX_CLASS =
  'rounded-lg border border-[#e7e9ed] px-[18px] py-3 text-[#161c2d]/70 text-[15px] tracking-[-0.1px]'
const SUBMIT_CLASS =
  'mt-2 rounded-lg bg-[#473bf0] py-4 font-bold text-[17px] text-white tracking-[-0.6px]'

export function ConsultationAbout({
  content,
  onChange,
  readOnly,
}: LandingPageSectionProps<AboutContent>) {
  const dropdowns = content.dropdowns ?? []

  function updateDropdown(index: number, patch: Partial<Dropdown>) {
    onChange?.({
      ...content,
      dropdowns: dropdowns.map((d, i) =>
        i === index ? { ...d, ...patch } : d,
      ),
    })
  }

  function setDropdownOption(
    dropdownIndex: number,
    optionIndex: number,
    value: string,
  ) {
    updateDropdown(dropdownIndex, {
      options: dropdowns[dropdownIndex].options.map((o, i) =>
        i === optionIndex ? value : o,
      ),
    })
  }

  function addDropdownOption(dropdownIndex: number) {
    updateDropdown(dropdownIndex, {
      options: [...dropdowns[dropdownIndex].options, 'Opção'],
    })
  }

  function removeDropdownOption(dropdownIndex: number, optionIndex: number) {
    updateDropdown(dropdownIndex, {
      options: dropdowns[dropdownIndex].options.filter(
        (_, i) => i !== optionIndex,
      ),
    })
  }

  return (
    <section className='relative overflow-hidden bg-[#161c2d] px-6 py-20 sm:px-10 sm:py-28 lg:px-[123px]'>
      <img
        src={PATTERN_BG}
        alt=''
        aria-hidden
        className='pointer-events-none absolute inset-0 size-full object-cover opacity-[0.14] mix-blend-multiply'
      />

      <div className='relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-2'>
        <div className='flex max-w-md flex-col gap-6'>
          <div className='flex size-[87px] items-center justify-center rounded-full bg-[#161c2d]/60'>
            <SteelIcon
              icon={Message01Icon}
              strokeWidth={2}
              size={32}
              className='text-[#68d585]'
            />
          </div>

          <GhostInput
            as='h2'
            value={content.title}
            onCommit={(v) => onChange?.({ ...content, title: v })}
            placeholder='Título da seção'
            readOnly={readOnly}
            className='text-balance font-bold text-[28px] text-white leading-tight tracking-[-1.2px] sm:text-[36px] sm:leading-[48px]'
          />

          <GhostTextarea
            value={content.description}
            onCommit={(v) => onChange?.({ ...content, description: v })}
            placeholder='Descrição'
            readOnly={readOnly}
            as='p'
            className='text-[19px] text-white/65 leading-[1.7]'
          />
        </div>

        <div
          aria-hidden={readOnly || undefined}
          className='flex flex-col gap-4 rounded-[10px] border border-[#e7e9ed] bg-white p-8 shadow-[0px_34px_33px_-23px_rgba(22,28,45,0.13)]'
        >
          {FORM_FIELDS.map((field) => {
            const labelKey = `form.${field.key}.label`
            const placeholderKey = `form.${field.key}.placeholder`
            const label = textOf(content, labelKey, field.label)
            const placeholder = textOf(
              content,
              placeholderKey,
              field.placeholder,
            )
            if (readOnly) {
              return (
                <label key={field.key} className='flex flex-col gap-2'>
                  <span className={FIELD_LABEL_CLASS}>{label}</span>
                  <input
                    disabled
                    placeholder={placeholder}
                    className={FIELD_BOX_CLASS}
                  />
                </label>
              )
            }
            // Edit mode: the label and the decorative placeholder become
            // ghost inputs styled like the static field.
            return (
              <div key={field.key} className='flex flex-col gap-2'>
                <GhostInput
                  value={label}
                  onCommit={(v) => onChange?.(withText(content, labelKey, v))}
                  placeholder='Rótulo do campo'
                  className={FIELD_LABEL_CLASS}
                />
                <div className={FIELD_BOX_CLASS}>
                  <GhostInput
                    value={placeholder}
                    onCommit={(v) =>
                      onChange?.(withText(content, placeholderKey, v))
                    }
                    placeholder='Texto de exemplo do campo'
                    className='text-inherit'
                  />
                </div>
              </div>
            )
          })}
          {dropdowns.map((dropdown, index) => (
            <DropdownField
              key={index}
              dropdown={dropdown}
              onLabelChange={(label) => updateDropdown(index, { label })}
              onOptionChange={(optionIndex, value) =>
                setDropdownOption(index, optionIndex, value)
              }
              onAddOption={() => addDropdownOption(index)}
              onRemoveOption={(optionIndex) =>
                removeDropdownOption(index, optionIndex)
              }
              readOnly={readOnly}
            />
          ))}
          {readOnly ? (
            <button type='button' disabled className={SUBMIT_CLASS}>
              {textOf(content, 'form.submit', 'Get Free Consultancy')}
            </button>
          ) : (
            <div className={`${SUBMIT_CLASS} px-4 text-center`}>
              <GhostInput
                value={textOf(content, 'form.submit', 'Get Free Consultancy')}
                onCommit={(v) =>
                  onChange?.(withText(content, 'form.submit', v))
                }
                placeholder='Texto do botão'
                className='text-center text-inherit'
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
