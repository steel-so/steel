import { auditMutation } from '@/lib/axiom/audit'
import { pabxExtensionRequired, pabxWebphoneNotEnabled } from '@/src/errors'
import { provisionWebphone } from '@/src/lib/pabx/webphone'
import { err, type Result } from '@/src/lib/result'
import { UserRepository } from '@/src/repositories/user.repository'
import type { WebphoneCredentialsDTO } from '@/types/pabx-webphone'

export const WebphoneService = {
  /**
   * SIP credentials for the actor's own extension, so the browser can register
   * and place/answer calls. The secret leaves the PABX only for a user whose
   * extension/device pair an administrator approved (`pabxWebphoneEnabled`);
   * editing the pair in the profile drops that approval.
   */
  async getCredentials(
    actorId: string,
  ): Promise<Result<WebphoneCredentialsDTO>> {
    const actor = await UserRepository.findById(actorId)
    if (!actor.ok) return actor

    const { pabxExtension, pabxDeviceId, pabxWebphoneEnabled } = actor.value
    if (!pabxExtension || !pabxDeviceId) return err(pabxExtensionRequired())
    if (!pabxWebphoneEnabled) return err(pabxWebphoneNotEnabled())

    const credentials = await provisionWebphone(pabxDeviceId, pabxExtension)

    auditMutation({
      entity: 'pabx_webphone',
      action: 'grant',
      actorId,
      targetId: actorId,
      outcome: credentials.ok ? 'success' : 'failure',
      reason: credentials.ok ? undefined : credentials.error.code,
      meta: { deviceId: pabxDeviceId, extension: pabxExtension },
    })

    return credentials
  },
}
