import type {
  InspectorField,
  InspectorSection,
} from '@/src/lib/canvas/registry'
import { SITE_ICONS } from './icons'
import { SITE_TEXT_PRESET_LABELS, type SiteTextPreset } from './theme'

/** Inspector pieces shared by the site components (pt-BR labels). */

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'Esquerda', icon: 'text-left' },
  { value: 'center', label: 'Centro', icon: 'text-center' },
  { value: 'right', label: 'Direita', icon: 'text-right' },
]

export const ICON_OPTIONS = Object.entries(SITE_ICONS).map(([value, icon]) => ({
  value,
  label: icon.label,
}))

export function presetOptions(presets: readonly SiteTextPreset[]) {
  return presets.map((value) => ({
    value,
    label: SITE_TEXT_PRESET_LABELS[value],
  }))
}

export const BUTTON_VARIANT_OPTIONS = [
  { value: 'primary', label: 'Principal' },
  { value: 'secondary', label: 'Secundário' },
  { value: 'outline', label: 'Contorno' },
  { value: 'link', label: 'Link' },
]

export const ASPECT_RATIO_LABELS: Record<string, string> = {
  auto: 'Original',
  '1/1': 'Quadrado (1:1)',
  '4/3': 'Paisagem (4:3)',
  '3/2': 'Foto (3:2)',
  '16/9': 'Widescreen (16:9)',
  '3/4': 'Retrato (3:4)',
  '9/16': 'Vertical (9:16)',
  '21/9': 'Panorâmico (21:9)',
}

export const SITE_LINK_TARGETS: Array<
  'url' | 'page' | 'anchor' | 'email' | 'phone' | 'file'
> = ['url', 'page', 'anchor', 'email', 'phone', 'file']

export const marginField: InspectorField = {
  path: 'margin',
  label: 'Margem externa',
  responsive: true,
  control: { kind: 'spacing', max: 400 },
}

/** "Avançado": visibility per breakpoint and the anchor id. */
export const advancedSection: InspectorSection = {
  id: 'advanced',
  label: 'Visibilidade e âncora',
  tab: 'advanced',
  fields: [
    {
      path: 'visibility',
      label: 'Mostrar em',
      control: { kind: 'visibility' },
    },
    {
      path: 'anchor',
      label: 'Âncora',
      help: 'Identificador para links do tipo âncora (ex.: contato). Use letras, números, - e _.',
      control: { kind: 'text', placeholder: 'contato', maxLength: 60 },
    },
  ],
}

export function spacingSection(extra: InspectorField[] = []): InspectorSection {
  return {
    id: 'spacing',
    label: 'Espaçamento',
    tab: 'style',
    fields: [marginField, ...extra],
  }
}

export const boxSection: InspectorSection = {
  id: 'box',
  label: 'Borda e sombra',
  tab: 'style',
  collapsed: true,
  fields: [
    { path: 'border', label: 'Borda', control: { kind: 'border' } },
    { path: 'radius', label: 'Cantos', control: { kind: 'radius' } },
    { path: 'shadow', label: 'Sombra', control: { kind: 'shadow' } },
  ],
}
