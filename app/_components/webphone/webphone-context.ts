import { createContext, useContext } from 'react'
import type { WebPhoneCall, WebPhoneStatus } from '@/src/lib/webphone/client'

export type WebPhoneUiStatus =
  | WebPhoneStatus
  /** The phone is open in another tab of this browser. */
  | 'other-tab'

export interface WebPhoneApi {
  /** The user has a browser phone (extension approved by an administrator). */
  enabled: boolean
  status: WebPhoneUiStatus
  /** Last connection problem, in user-facing words. */
  error: string | null
  call: WebPhoneCall | null
  /** Notice the agent reads to the contact on a call being recorded. */
  recordingNotice: string | null
  dial: (
    phone: string,
    name?: string | null,
    options?: { conversationId?: string | null },
  ) => Promise<void>
  answer: () => Promise<void>
  hangup: () => Promise<void>
  toggleMute: () => void
  sendDtmf: (tone: string) => void
  reconnect: () => void
}

const idle: WebPhoneApi = {
  enabled: false,
  status: 'offline',
  error: null,
  call: null,
  recordingNotice: null,
  dial: async () => undefined,
  answer: async () => undefined,
  hangup: async () => undefined,
  toggleMute: () => undefined,
  sendDtmf: () => undefined,
  reconnect: () => undefined,
}

export const WebPhoneContext = createContext<WebPhoneApi>(idle)

/** Browser phone state/actions; inert (`enabled: false`) outside a provider. */
export function useWebPhone(): WebPhoneApi {
  return useContext(WebPhoneContext)
}
