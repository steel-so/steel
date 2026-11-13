import { formatBytes } from '@/app/_components/crm/sites/format'

/** Formats every builder bucket accepts. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export { formatBytes }

/**
 * The one place that decides whether a picked, dropped or pasted file can
 * be uploaded. Returns the pt-BR reason, or `null` when it is fine.
 */
export function imageFileProblem(
  file: Pick<File, 'name' | 'type' | 'size'>,
  accept: readonly string[] = IMAGE_TYPES,
): string | null {
  const allowed = accept.filter((type) => type !== 'image/*')
  const types = allowed.length > 0 ? allowed : IMAGE_TYPES
  if (!(types as readonly string[]).includes(file.type)) {
    return `${file.name}: use JPEG, PNG ou WebP.`
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return `${file.name}: o limite é 5 MB (esta tem ${formatBytes(file.size)}).`
  }
  return null
}

/** Whether a drag carries files (and not text or a page element). */
export function hasFiles(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && [...dataTransfer.types].includes('Files')
}

/** Files of a drop or paste (non-images included, so they get a reason). */
export function filesOf(dataTransfer: DataTransfer | null): File[] {
  return dataTransfer ? [...dataTransfer.files] : []
}
