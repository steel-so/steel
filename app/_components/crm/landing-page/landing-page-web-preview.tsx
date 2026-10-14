import { sectionAnchors } from '@/app/_components/crm/landing-page/section-anchors'
import { getSectionDefinition } from '@/app/_components/crm/landing-page/sections/registry'
import type { CrmLandingPageSectionDTO } from '@/types/crm-landing-page'

/**
 * Render público (somente leitura) das seções de uma landing page —
 * usado tanto na página `/l/[shareToken]` quanto poderia ser reaproveitado
 * num preview futuro. Sem `onChange`/upload: cada seção recebe `readOnly`,
 * que já desliga toda a interação nos componentes de seção. Cada seção vem
 * embrulhada num elemento com a âncora dela (`#servicos`), alvo dos links
 * internos escolhidos no editor.
 */
export function LandingPageWebPreview({
  templateKey,
  sections,
}: {
  templateKey: string
  sections: CrmLandingPageSectionDTO[]
}) {
  const enabled = sections.filter((section) => section.enabled)
  const anchors = sectionAnchors(enabled)
  return (
    <>
      {enabled.map((section, index) => {
        const { Component } = getSectionDefinition(templateKey, section.type)
        return (
          <div key={section.id} id={anchors[index]?.id} className='scroll-mt-4'>
            <Component content={section.content} readOnly />
          </div>
        )
      })}
    </>
  )
}
