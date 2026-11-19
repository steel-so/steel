import { auditMutation } from '@/lib/axiom/audit'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmGoogleApiFailed, validationError } from '@/src/errors'
import {
  buildDescriptionSystem,
  fitToLimit,
} from '@/src/lib/google-business/ai-prompts'
import {
  createMedia,
  deleteMedia,
  getAttributes,
  getLocation,
  listAttributeMetadata,
  listMedia,
  patchAttributes,
  patchLocation,
  searchCategories,
} from '@/src/lib/google-business/client'
import { buildLinks } from '@/src/lib/google-business/links'
import {
  buildLocationPatch,
  mapCategories,
  mapLocationToProfile,
  mergeWithCurrent,
  validatePeriods,
} from '@/src/lib/google-business/profile'
import { err, ok, type Result } from '@/src/lib/result'
import { putBlob, removeBlob } from '@/src/lib/social/blob-store'
import { CrmGoogleConnectionRepository } from '@/src/repositories/crm-google-presence.repository'
import {
  GOOGLE_DESCRIPTION_MAX,
  GOOGLE_PHOTO_CATEGORIES,
  GOOGLE_PHOTO_MAX_BYTES,
  GOOGLE_PHOTO_TYPES,
  type GoogleAttributeDTO,
  type GoogleCategoryDTO,
  type GoogleDescriptionSuggestionDTO,
  type GoogleLinksDTO,
  type GooglePhotoDTO,
  type GoogleProfileDTO,
  type UpdateGoogleAttributesDTO,
  type UpdateGoogleProfileDTO,
} from '@/src/schemas/crm-google-presence.schema'
import { assertModuleMember } from './authz'
import { runGoogleSuggestion } from './crm-google-ai'
import { googleLocationAccessFor } from './crm-google-token'

const SOCIAL = 'social' as const

/** Photos and attributes are extras of the checklist: a failure only hides them. */
async function loadProfile(access: {
  accessToken: string
  locationName: string
  fullLocationName: string
}): Promise<Result<GoogleProfileDTO>> {
  const [location, media, attributes] = await Promise.all([
    getLocation(access.accessToken, access.locationName),
    listMedia(access.accessToken, access.fullLocationName),
    getAttributes(access.accessToken, access.locationName),
  ])
  if (!location.ok) return location
  return ok(
    mapLocationToProfile(location.value, {
      photoCount: media.ok ? media.value.total : null,
      attributesFilled: attributes.ok
        ? attributes.value.filter((a) => (a.values?.length ?? 0) > 0).length
        : null,
    }),
  )
}

export const CrmGoogleProfileService = {
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleProfileDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    return loadProfile(access.value)
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateGoogleProfileDTO,
  ): Promise<Result<GoogleProfileDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    if (dto.hours) {
      const problem = validatePeriods(dto.hours)
      if (problem) return err(validationError(problem))
    }

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access

    const current = await getLocation(
      access.value.accessToken,
      access.value.locationName,
    )
    if (!current.ok) return current
    const currentProfile = mapLocationToProfile(current.value, {
      photoCount: null,
      attributesFilled: null,
    })

    const { updateMask, body } = buildLocationPatch(
      mergeWithCurrent(dto, currentProfile),
    )
    const patched = await patchLocation(
      access.value.accessToken,
      access.value.locationName,
      updateMask,
      body,
    )
    if (!patched.ok) {
      auditMutation({
        entity: 'crm_google_profile',
        action: 'update',
        actorId,
        outcome: 'failure',
        reason: patched.error.code,
        meta: { workspaceId, fields: updateMask },
      })
      return patched
    }

    if (dto.title !== undefined) {
      await CrmGoogleConnectionRepository.setLocation(
        access.value.connection.id,
        {
          accountName: access.value.accountName,
          locationName: access.value.locationName,
          locationTitle: dto.title,
          placeId: access.value.connection.placeId,
          mapsUri: access.value.connection.mapsUri,
          newReviewUri: access.value.connection.newReviewUri,
        },
      )
    }

    auditMutation({
      entity: 'crm_google_profile',
      action: 'update',
      actorId,
      targetId: access.value.locationName,
      meta: { workspaceId, fields: updateMask },
    })
    return loadProfile(access.value)
  },

  async searchCategories(
    actorId: string,
    workspaceId: string,
    term: string,
  ): Promise<Result<GoogleCategoryDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const found = await searchCategories(access.value.accessToken, term)
    if (!found.ok) return found
    return ok(mapCategories(found.value))
  },

  /** Yes/no attributes of the location (Wi-Fi, estacionamento…), with their value. */
  async listAttributes(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleAttributeDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access

    const [metadata, current] = await Promise.all([
      listAttributeMetadata(
        access.value.accessToken,
        access.value.locationName,
      ),
      getAttributes(access.value.accessToken, access.value.locationName),
    ])
    if (!metadata.ok) return metadata

    const values = new Map<string, unknown>()
    for (const attribute of current.ok ? current.value : []) {
      if (attribute.name) values.set(attribute.name, attribute.values?.[0])
    }
    const items: GoogleAttributeDTO[] = metadata.value
      .flatMap((item) =>
        item.parent && item.valueType === 'BOOL' && !item.deprecated
          ? [{ ...item, parent: item.parent }]
          : [],
      )
      .map((item) => {
        const value = values.get(item.parent)
        return {
          name: item.parent,
          displayName: item.displayName ?? item.parent,
          group: item.groupDisplayName ?? null,
          editable: true,
          value: typeof value === 'boolean' ? value : null,
        }
      })
      .sort(
        (a, b) =>
          (a.group ?? '').localeCompare(b.group ?? '', 'pt-BR') ||
          a.displayName.localeCompare(b.displayName, 'pt-BR'),
      )
    return ok(items)
  },

  async updateAttributes(
    actorId: string,
    workspaceId: string,
    dto: UpdateGoogleAttributesDTO,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access

    const patched = await patchAttributes(
      access.value.accessToken,
      access.value.locationName,
      dto.attributes,
    )
    if (!patched.ok) return patched

    auditMutation({
      entity: 'crm_google_profile',
      action: 'update',
      actorId,
      targetId: access.value.locationName,
      meta: {
        workspaceId,
        fields: ['attributes'],
        count: dto.attributes.length,
      },
    })
    return ok(undefined)
  },

  async listPhotos(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GooglePhotoDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const media = await listMedia(
      access.value.accessToken,
      access.value.fullLocationName,
    )
    if (!media.ok) return media

    return ok(
      media.value.items.flatMap((item) =>
        item.name && item.googleUrl && item.mediaFormat !== 'VIDEO'
          ? [
              {
                name: item.name,
                url: item.googleUrl,
                thumbnailUrl: item.thumbnailUrl ?? item.googleUrl,
                category: item.locationAssociation?.category ?? null,
                createdAt: item.createTime ?? null,
              },
            ]
          : [],
      ),
    )
  },

  /**
   * Uploads a photo: Google fetches it from a URL, so the bytes are parked in
   * the short-lived public blob store (the same one the Instagram publisher
   * uses) while the call runs.
   */
  async addPhoto(
    actorId: string,
    workspaceId: string,
    file: { bytes: ArrayBuffer; contentType: string },
    category: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    if (!(GOOGLE_PHOTO_TYPES as readonly string[]).includes(file.contentType)) {
      return err(validationError('Envie uma imagem JPG ou PNG.'))
    }
    if (file.bytes.byteLength > GOOGLE_PHOTO_MAX_BYTES) {
      return err(validationError('A foto deve ter no máximo 5 MB.'))
    }
    if (file.bytes.byteLength < 10 * 1024) {
      return err(validationError('A foto é pequena demais (mínimo 10 KB).'))
    }
    if (!(GOOGLE_PHOTO_CATEGORIES as readonly string[]).includes(category)) {
      return err(validationError('Tipo de foto inválido.'))
    }

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access

    const token = await putBlob(file.bytes, file.contentType)
    try {
      const created = await createMedia(
        access.value.accessToken,
        access.value.fullLocationName,
        {
          sourceUrl: `${BETTER_AUTH_URL.replace(/\/$/, '')}/api/social/blob/${token}`,
          category,
        },
      )
      if (!created.ok) return created
    } finally {
      await removeBlob(token)
    }

    auditMutation({
      entity: 'crm_google_profile',
      action: 'upload',
      actorId,
      targetId: access.value.locationName,
      meta: { workspaceId, category, bytes: file.bytes.byteLength },
    })
    return ok(undefined)
  },

  async deletePhoto(
    actorId: string,
    workspaceId: string,
    mediaName: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    // Only photos of the connected location can be removed.
    if (!mediaName.startsWith(`${access.value.fullLocationName}/media/`)) {
      return err(crmGoogleApiFailed('Esta foto não pertence ao seu local.'))
    }

    const removed = await deleteMedia(access.value.accessToken, mediaName)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'crm_google_profile',
      action: 'delete',
      actorId,
      targetId: mediaName,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  /** Public links (Maps, avaliar, rotas, embed) built from the location. */
  async getLinks(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleLinksDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const location = await getLocation(
      access.value.accessToken,
      access.value.locationName,
    )
    if (!location.ok) return location

    const profile = mapLocationToProfile(location.value, {
      photoCount: null,
      attributesFilled: null,
    })
    return ok(
      buildLinks({
        title: profile.title,
        placeId: profile.placeId ?? access.value.connection.placeId,
        mapsUri: profile.mapsUri ?? access.value.connection.mapsUri,
        newReviewUri:
          profile.newReviewUri ?? access.value.connection.newReviewUri,
        latitude: profile.latitude,
        longitude: profile.longitude,
        address: profile.address,
      }),
    )
  },

  async suggestDescription(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<GoogleDescriptionSuggestionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const access = await googleLocationAccessFor(workspaceId)
    if (!access.ok) return access
    const location = await getLocation(
      access.value.accessToken,
      access.value.locationName,
    )
    if (!location.ok) return location
    const profile = mapLocationToProfile(location.value, {
      photoCount: null,
      attributesFilled: null,
    })

    const suggestion = await runGoogleSuggestion({
      actorId,
      workspaceId,
      surface: 'description',
      system: buildDescriptionSystem({
        title: profile.title,
        categories: [
          profile.primaryCategory?.displayName,
          ...profile.additionalCategories.map((c) => c.displayName),
        ].filter((name): name is string => Boolean(name)),
        address: profile.address,
        currentDescription: profile.description,
        tone: access.value.connection.replyTone,
      }),
      user: 'Escreva a descrição do perfil.',
    })
    if (!suggestion.ok) return suggestion
    return ok({
      suggestion: fitToLimit(suggestion.value, GOOGLE_DESCRIPTION_MAX),
    })
  },
}
