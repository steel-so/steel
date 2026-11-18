import { waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  apiError,
  apiSuccess,
  getFetchCall,
  mockFetch,
  renderHookWithProviders,
} from '@/src/__tests__/helpers/component'
import { useNumberValidationAvailability } from '@/src/hooks/use-whatsapp-number-validation-availability'

describe('useNumberValidationAvailability', () => {
  it('reads the availability of the workspace', async () => {
    const spy = mockFetch().mockResolvedValueOnce(
      apiSuccess({ available: true, source: 'PLATFORM' }),
    )
    const { result } = renderHookWithProviders(() =>
      useNumberValidationAvailability('ws_1'),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ available: true, source: 'PLATFORM' })
    expect(getFetchCall(spy).url).toBe(
      '/api/workspaces/ws_1/whatsapp/number-validation/availability',
    )
  })

  it('exposes an error when the request fails', async () => {
    mockFetch().mockResolvedValueOnce(apiError(500, 'boom'))
    const { result } = renderHookWithProviders(() =>
      useNumberValidationAvailability('ws_1'),
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
