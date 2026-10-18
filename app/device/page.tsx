import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { consume, deviceVerifyLimiter } from '@/src/lib/rate-limit'
import { UserCodeSchema } from '@/src/schemas/api-token.schema'
import { DeviceAuthorizationService } from '@/src/services/device-authorization.service'
import {
  DeviceAuthorizeForm,
  DeviceCodeEntry,
  DeviceError,
} from './device-form'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * Confirmation page of `steel login` (device flow, ADR 0035). The CLI opens
 * `/device?code=ABCD-EFGH`; without a code the user types it. The user picks
 * the workspace, modules, access level and validity of the token the CLI
 * receives. The proxy already guarantees a session cookie; an expired one
 * still sends the user to sign in and back.
 */
export default async function DevicePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const params = await searchParams
  const raw = typeof params.code === 'string' ? params.code : null

  const session = await getAuthSession()
  if (!session.ok) {
    const back = raw ? `/device?code=${encodeURIComponent(raw)}` : '/device'
    redirect(`/sign-in?redirect=${encodeURIComponent(back)}`)
  }

  if (!raw) return <DeviceCodeEntry />

  const code = UserCodeSchema.safeParse(raw)
  if (!code.success) {
    return (
      <DeviceCodeEntry
        initialCode={raw}
        error='O código tem 8 letras e números, como BCDF-GH23.'
      />
    )
  }

  const limit = await consume(
    deviceVerifyLimiter,
    `user:${session.value.user.id}`,
  )
  if (!limit.ok) return <DeviceError message={limit.error.message} />

  const context = await DeviceAuthorizationService.getContext(
    session.value.user.id,
    code.data,
  )
  if (!context.ok) {
    return context.error.code === 'DEVICE_CODE_INVALID' ? (
      <DeviceCodeEntry initialCode={raw} error={context.error.message} />
    ) : (
      <DeviceError message={context.error.message} />
    )
  }

  return (
    <DeviceAuthorizeForm
      context={context.value}
      userEmail={session.value.user.email}
    />
  )
}
