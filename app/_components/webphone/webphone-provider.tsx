'use client'

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { apiFetch } from '@/src/hooks/_fetch'
import { useUser } from '@/src/hooks/use-user'
import { WebPhoneCallTracker } from '@/src/lib/webphone/call-tracker'
import type { WebPhoneCall, WebPhoneClient } from '@/src/lib/webphone/client'
import type { WebphoneCredentialsDTO } from '@/types/pabx-webphone'
import {
  type WebPhoneApi,
  WebPhoneContext,
  type WebPhoneUiStatus,
} from './webphone-context'
import { WebPhoneDock } from './webphone-dock'

/**
 * Keeps the user's browser phone registered while the app is open, in one tab
 * only (a Web Lock): two tabs registering the same extension would take the
 * registration from each other. The SIP library is loaded on demand.
 */
export function WebPhoneProvider({
  children,
  workspaceId,
}: {
  children: ReactNode
  workspaceId: string
}) {
  const user = useUser()
  const userId = user.data?.id
  const enabled = Boolean(
    user.data?.pabxWebphoneEnabled &&
      user.data.pabxExtension &&
      user.data.pabxDeviceId,
  )

  const audioRef = useRef<HTMLAudioElement>(null)
  const clientRef = useRef<WebPhoneClient | null>(null)
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  // Reports each call to the Steel (history, recording); one per workspace.
  const tracker = useMemo(
    () => new WebPhoneCallTracker(workspaceId, setRecordingNotice),
    [workspaceId],
  )
  const trackerRef = useRef(tracker)
  trackerRef.current = tracker
  const [status, setStatus] = useState<WebPhoneUiStatus>('offline')
  const [error, setError] = useState<string | null>(null)
  const [call, setCall] = useState<WebPhoneCall | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // `attempt` only forces a new boot after a failure ("Reconectar").
    void attempt
    if (!enabled || !userId) return

    let cancelled = false
    let release: (() => void) | undefined

    async function boot(): Promise<void> {
      setStatus('connecting')
      setError(null)
      try {
        const credentials = await apiFetch<WebphoneCredentialsDTO>(
          '/api/users/me/webphone',
          { cache: 'no-store' },
          'Não foi possível preparar o telefone web',
        )
        const audio = audioRef.current
        if (cancelled || !audio) return
        const { WebPhoneClient } = await import('@/src/lib/webphone/client')
        if (cancelled) return
        const client = new WebPhoneClient(credentials, audio, {
          onStatus: (next, detail) => {
            setStatus(next)
            setError(detail ?? null)
          },
          onCall: setCall,
          onCallEvent: (event) => trackerRef.current.handle(event),
        })
        clientRef.current = client
        await client.start()
      } catch (cause) {
        if (cancelled) return
        setStatus('error')
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível conectar o telefone web',
        )
      }
    }

    async function shutdown(): Promise<void> {
      const client = clientRef.current
      clientRef.current = null
      await client?.stop()
      setCall(null)
    }

    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      // Waits while another tab holds the phone and takes over when it closes.
      setStatus('other-tab')
      void navigator.locks.request(`steel-webphone:${userId}`, async () => {
        if (cancelled) return
        await boot()
        // Cancelled while booting: nobody will call `release`, so don't wait.
        if (!cancelled) {
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        await shutdown()
      })
    } else {
      void boot()
      release = () => void shutdown()
    }

    return () => {
      cancelled = true
      release?.()
    }
  }, [enabled, userId, attempt])

  const dial = useCallback<WebPhoneApi['dial']>(
    async (phone, name = null, options = {}) => {
      const client = clientRef.current
      if (!client) throw new Error('O telefone web não está conectado.')
      // Registered first: the INVITE carries the callback the PABX reports to.
      const extraHeaders = await trackerRef.current.prepareOutbound({
        number: phone,
        name,
        conversationId: options.conversationId,
      })
      try {
        await client.dial(phone, name, { extraHeaders })
      } catch (error) {
        trackerRef.current.abandonPrepared()
        throw error
      }
    },
    [],
  )

  const api = useMemo<WebPhoneApi>(
    () => ({
      enabled,
      status: enabled ? status : 'offline',
      error,
      call,
      recordingNotice,
      dial,
      answer: async () => clientRef.current?.answer(),
      hangup: async () => clientRef.current?.hangup(),
      toggleMute: () => clientRef.current?.setMuted(!call?.muted),
      sendDtmf: (tone) => clientRef.current?.sendDtmf(tone),
      reconnect: () => setAttempt((n) => n + 1),
    }),
    [enabled, status, error, call, recordingNotice, dial],
  )

  return (
    <WebPhoneContext.Provider value={api}>
      {children}
      {/* biome-ignore lint/a11y/useMediaCaption: live call audio has no captions */}
      <audio ref={audioRef} autoPlay className='hidden' />
      {enabled && <WebPhoneDock />}
    </WebPhoneContext.Provider>
  )
}
