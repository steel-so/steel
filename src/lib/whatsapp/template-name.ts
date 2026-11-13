/** Longest template name the Meta API accepts. */
export const TEMPLATE_NAME_MAX = 512

/**
 * Turns the title the user typed ("Confirmação de exame") into the technical
 * name Meta requires (lowercase letters, digits and underscores).
 */
export function templateNameFromTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, TEMPLATE_NAME_MAX)
}
