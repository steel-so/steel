import type {
  InspectorField,
  InspectorSection,
} from '@/src/lib/canvas/registry'

/** Inspector pieces shared by the `document` components (pt-BR labels). */

export const ALIGN_OPTIONS = [
  { value: 'left', label: 'Esquerda', icon: 'text-left' },
  { value: 'center', label: 'Centro', icon: 'text-center' },
  { value: 'right', label: 'Direita', icon: 'text-right' },
]

export const VARIABLES_HELP =
  'Use variáveis como {{contato.nome}}: veja a aba Variáveis à esquerda.'

export const alignField: InspectorField = {
  path: 'align',
  label: 'Alinhamento',
  control: { kind: 'segmented', options: ALIGN_OPTIONS },
}

export function colorField(path: string, label: string): InspectorField {
  return {
    path,
    label,
    control: { kind: 'color', allowTokens: true },
  }
}

export const backgroundField: InspectorField = {
  path: 'background',
  label: 'Fundo',
  control: { kind: 'background', allowImage: true, allowGradient: true },
}

export const paddingField: InspectorField = {
  path: 'padding',
  label: 'Espaçamento interno',
  control: { kind: 'spacing', max: 200 },
}

export const radiusField: InspectorField = {
  path: 'radius',
  label: 'Cantos (px)',
  control: { kind: 'number', min: 0, max: 64, unit: 'px' },
}

export function textField(
  path: string,
  label: string,
  options: { rows?: number; maxLength?: number; help?: string } = {},
): InspectorField {
  return {
    path,
    label,
    help: options.help,
    control: options.rows
      ? { kind: 'textarea', rows: options.rows, maxLength: options.maxLength }
      : { kind: 'text', maxLength: options.maxLength },
  }
}

export function toggleField(
  path: string,
  label: string,
  help?: string,
): InspectorField {
  return { path, label, help, control: { kind: 'toggle' } }
}

export function section(
  id: string,
  label: string,
  fields: InspectorField[],
  tab: InspectorSection['tab'] = 'content',
): InspectorSection {
  return { id, label, tab, fields }
}
