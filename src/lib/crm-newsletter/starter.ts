import type { CanvasDocument } from '@/src/lib/canvas/types'
import { convertV1Document } from '@/src/lib/canvas-email/convert-v1'

/**
 * Starting document of a newsletter issue created without a template
 * (ADR 0054): the brand header (logo), the issue title with an intro, one
 * content section and a signature, then the required footer — which the
 * newsletter renders as its subscription footer. Placeholder copy in pt-BR
 * the editor replaces; the newsletter name only goes into plain-text props.
 */
export function createNewsletterStarterDocument(
  newsletterName: string,
): CanvasDocument {
  const name = newsletterName.trim().slice(0, 100)
  return convertV1Document({
    version: 1,
    layout: 'newsletter',
    previewText: '',
    sections: [
      { id: 'header', type: 'header', hidden: false, props: {} },
      {
        id: 'title',
        type: 'text',
        hidden: false,
        props: {
          heading: 'Título da edição',
          body: '<p>Olá, {{primeiro_nome|tudo bem}}! Escreva aqui uma introdução curta: o que o leitor vai encontrar nesta edição.</p>',
        },
      },
      {
        id: 'content',
        type: 'text',
        hidden: false,
        props: {
          heading: 'Assunto principal',
          body: '<p>Conte a história principal da edição. Use <strong>negrito</strong> para destacar o que importa e acrescente blocos pelo painel à esquerda.</p>',
        },
      },
      {
        id: 'signature',
        type: 'signature',
        hidden: false,
        props: {
          closing: 'Até a próxima edição,',
          name: name ? `Equipe ${name}`.slice(0, 120) : 'Nossa equipe',
          role: '',
          contact: '',
        },
      },
      { id: 'footer', type: 'footer', hidden: false, props: { note: '' } },
    ],
  })
}
