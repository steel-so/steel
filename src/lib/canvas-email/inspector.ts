import type {
  InspectorField,
  InspectorSection,
} from '@/src/lib/canvas/registry'
import { CAMPAIGN_LINK } from '@/src/lib/crm-email-builder/variables'
import { EMAIL_FONTS } from './theme'

/** Inspector pieces shared by the e-mail components (pt-BR copy). */

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'Esquerda', icon: 'text-left' },
  { value: 'center', label: 'Centro', icon: 'text-center' },
  { value: 'right', label: 'Direita', icon: 'text-right' },
]

export const VALIGN_OPTIONS = [
  { value: 'top', label: 'Topo', icon: 'align-top' },
  { value: 'middle', label: 'Meio', icon: 'align-middle' },
  { value: 'bottom', label: 'Base', icon: 'align-bottom' },
]

export const FONT_OPTIONS = EMAIL_FONTS.map((font) => ({
  value: font.id,
  label: font.google ? `${font.label} (Google Fonts)` : font.label,
}))

/** Links an e-mail supports (no pages, anchors or files). */
export const EMAIL_LINK_TARGETS: Array<'url' | 'email' | 'phone'> = [
  'url',
  'email',
  'phone',
]

export function alignField(path = 'align'): InspectorField {
  return {
    path,
    label: 'Alinhamento',
    responsive: true,
    control: { kind: 'segmented', options: ALIGN_OPTIONS },
  }
}

export function linkField(path = 'link', label = 'Link'): InspectorField {
  return {
    path,
    label,
    control: {
      kind: 'link',
      targets: EMAIL_LINK_TARGETS,
      // In a campaign each recipient gets the tracked link to the
      // destination (site page, form or landing page).
      quickValues: [{ label: 'Link da campanha', value: CAMPAIGN_LINK }],
    },
    help: 'Use {{campaign_link}} para o link rastreado da campanha.',
  }
}

export function colorField(path: string, label: string): InspectorField {
  return { path, label, control: { kind: 'color', allowTokens: true } }
}

export function typographyField(path = 'typography'): InspectorField {
  return {
    path,
    label: 'Tipografia',
    responsive: true,
    control: { kind: 'typography' },
  }
}

/** "Avançado": outer spacing and per-device visibility of a block. */
export const BLOCK_LAYOUT_SECTION: InspectorSection = {
  id: 'layout',
  label: 'Espaçamento e exibição',
  tab: 'advanced',
  fields: [
    {
      path: 'padding',
      label: 'Margem interna',
      responsive: true,
      control: { kind: 'spacing', min: 0, max: 200 },
    },
    {
      path: 'visibility',
      label: 'Exibir em',
      control: { kind: 'visibility' },
      help: 'Ocultar no computador ou no celular.',
    },
  ],
}
