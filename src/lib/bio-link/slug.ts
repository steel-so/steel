import { slugify } from '@/src/lib/sites/slug'

/** Addresses of the bio pages: `/b/<slug>`. */
export const BIO_SLUG_MIN = 3
export const BIO_SLUG_MAX = 40

const PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidBioSlug(slug: string): boolean {
  return (
    slug.length >= BIO_SLUG_MIN &&
    slug.length <= BIO_SLUG_MAX &&
    PATTERN.test(slug)
  )
}

/** A valid slug derived from a name (`Clínica São Lucas` → `clinica-sao-lucas`). */
export function bioSlugFromName(name: string): string {
  const base = slugify(name, BIO_SLUG_MAX - 5)
  if (isValidBioSlug(base)) return base
  return base ? `${base}-bio` : 'minha-bio'
}

/** `base`, then `base-2`, `base-3`… trimmed to fit the limit. */
export function bioSlugWithSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base
  const suffix = `-${attempt}`
  return `${base.slice(0, BIO_SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`
}
