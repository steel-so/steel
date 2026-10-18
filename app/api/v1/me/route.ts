import { apiV1Route } from '@/src/lib/api/v1-route'
import { ApiV1Service } from '@/src/services/api-v1.service'

/** `steel whoami`: the token's owner, workspace, scopes, modules, expiry. */
export const GET = apiV1Route({
  access: 'read',
  handler: ({ session }) => ApiV1Service.me(session),
})
