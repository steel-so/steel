import type {
  GoogleCategoryDTO,
  GoogleHoursPeriodDTO,
  GoogleProfileDTO,
  UpdateGoogleProfileDTO,
} from '@/src/schemas/crm-google-presence.schema'

/** What the profile form edits; compared with the saved profile to find changes. */
export type GoogleProfileDraft = {
  title: string
  description: string
  primaryPhone: string
  websiteUri: string
  primaryCategory: GoogleCategoryDTO | null
  additionalCategories: GoogleCategoryDTO[]
  hours: GoogleHoursPeriodDTO[]
}

export function draftFromProfile(
  profile: GoogleProfileDTO,
): GoogleProfileDraft {
  return {
    title: profile.title,
    description: profile.description,
    primaryPhone: profile.primaryPhone ?? '',
    websiteUri: profile.websiteUri ?? '',
    primaryCategory: profile.primaryCategory,
    additionalCategories: profile.additionalCategories,
    hours: profile.hours,
  }
}

const sameHours = (a: GoogleHoursPeriodDTO[], b: GoogleHoursPeriodDTO[]) =>
  a.length === b.length &&
  a.every(
    (period, i) =>
      period.day === b[i].day &&
      period.open === b[i].open &&
      period.close === b[i].close,
  )

const sameCategories = (a: GoogleCategoryDTO[], b: GoogleCategoryDTO[]) =>
  a.length === b.length && a.every((category, i) => category.name === b[i].name)

/**
 * Only the fields the user changed, ready for `PATCH /profile`; `null` when
 * nothing changed. Sending only the diff keeps Google from re-validating
 * (and rejecting) data the user did not touch.
 */
export function diffDraft(
  draft: GoogleProfileDraft,
  profile: GoogleProfileDTO,
): UpdateGoogleProfileDTO | null {
  const saved = draftFromProfile(profile)
  const update: UpdateGoogleProfileDTO = {}

  if (draft.title.trim() !== saved.title) update.title = draft.title.trim()
  if (draft.description.trim() !== saved.description.trim()) {
    update.description = draft.description.trim()
  }
  if (draft.primaryPhone.trim() !== saved.primaryPhone) {
    update.primaryPhone = draft.primaryPhone.trim() || null
  }
  if (draft.websiteUri.trim() !== saved.websiteUri) {
    update.websiteUri = draft.websiteUri.trim()
  }
  if (draft.primaryCategory?.name !== saved.primaryCategory?.name) {
    if (draft.primaryCategory) {
      update.primaryCategoryName = draft.primaryCategory.name
    }
  }
  if (!sameCategories(draft.additionalCategories, saved.additionalCategories)) {
    update.additionalCategoryNames = draft.additionalCategories.map(
      (category) => category.name,
    )
  }
  if (!sameHours(draft.hours, saved.hours)) update.hours = draft.hours

  return Object.keys(update).length > 0 ? update : null
}
