import type {
  FlowCrmAction,
  FlowDefinition,
} from '@/src/schemas/whatsapp-flow.schema'

/**
 * Problems that make a flow useless for its CRM action (pt-BR, shown in the
 * editor and returned as the publish error). A lead needs a way to reach the
 * person; a person needs a name or e-mail; a company needs a name.
 */
export function flowCrmIssues(
  definition: FlowDefinition,
  crmAction: FlowCrmAction,
): string[] {
  if (crmAction === 'NONE') return []
  const mappings = definition.screens
    .flatMap((screen) => screen.fields)
    .flatMap((field) => (field.mapping ? [field.mapping] : []))
  const has = (target: string, ...attributes: string[]) =>
    mappings.some(
      (m) => m.target === target && attributes.includes(m.attribute),
    )

  if (crmAction === 'LEAD' && !has('lead', 'email', 'phone')) {
    return [
      'Para criar lead, mapeie um campo para o e-mail ou telefone do lead',
    ]
  }
  if (crmAction === 'PERSON' && !has('person', 'name', 'email')) {
    return [
      'Para criar pessoa, mapeie um campo para o nome ou e-mail da pessoa',
    ]
  }
  if (crmAction === 'COMPANY' && !has('company', 'name')) {
    return ['Para criar empresa, mapeie um campo para o nome da empresa']
  }
  return []
}
