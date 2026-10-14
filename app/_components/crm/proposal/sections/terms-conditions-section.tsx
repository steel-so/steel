'use client'

import { AiTextarea } from '@/components/ui/ai-text-field'
import type { CrmProposalSectionContent } from '@/src/schemas/crm-proposal.schema'

export type TermsConditionsContent = Extract<
  CrmProposalSectionContent,
  { type: 'TERMS_CONDITIONS' }
>

export function termsConditionsDefaultContent(): TermsConditionsContent {
  return { type: 'TERMS_CONDITIONS', text: 'Defina os termos e condições.' }
}

export function TermsConditionsEditor({
  content,
  onChange,
}: {
  content: TermsConditionsContent
  onChange: (content: TermsConditionsContent) => void
}) {
  return (
    <AiTextarea
      aiLabel='Termos e condições'
      rows={16}
      value={content.text}
      onChange={(e) => onChange({ ...content, text: e.target.value })}
    />
  )
}

export function TermsConditionsDisplay({
  content,
}: {
  content: TermsConditionsContent
}) {
  return (
    <section className='flex flex-col gap-4 rounded-lg border p-8'>
      <h2 className='font-semibold text-2xl'>Termos e condições</h2>
      <p className='whitespace-pre-wrap text-muted-foreground text-sm'>
        {content.text}
      </p>
    </section>
  )
}
