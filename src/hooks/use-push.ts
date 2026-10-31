'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  type PushSupport,
  pushSupport,
  serializePushSubscription,
  urlBase64ToUint8Array,
} from '@/src/lib/push/client'
import type { PushStatusDTO } from '@/types/push-subscription'
import { apiFetch } from './_fetch'

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const PUSH_KEY = ['push', 'status'] as const
const SW_URL = '/sw.js'

export class PushPermissionError extends Error {
  constructor() {
    super('Permissão de notificações negada')
    this.name = 'PushPermissionError'
  }
}

export function usePushStatus() {
  return useQuery({
    queryKey: PUSH_KEY,
    queryFn: () =>
      apiFetch<PushStatusDTO>(
        '/api/push/subscriptions',
        undefined,
        'Erro ao carregar o estado das notificações push',
      ),
    staleTime: 60 * 1000,
  })
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL)
  return registration ? registration.pushManager.getSubscription() : null
}

/** Push opt-in of this device: subscribe/unsubscribe with the server in sync. */
export function usePushDevice() {
  const queryClient = useQueryClient()
  const status = usePushStatus()
  const [support, setSupport] = useState<PushSupport>('supported')
  const [permission, setPermission] =
    useState<NotificationPermission>('default')
  const [thisDevice, setThisDevice] = useState(false)

  useEffect(() => {
    const supported = pushSupport()
    setSupport(supported)
    if (supported === 'unsupported') return
    setPermission(window.Notification.permission)
    currentSubscription()
      .then((subscription) => setThisDevice(subscription !== null))
      .catch(() => setThisDevice(false))
  }, [])

  const enable = useMutation({
    mutationFn: async () => {
      const publicKey = status.data?.publicKey
      if (!publicKey) throw new Error('Notificações push indisponíveis')
      const result = await window.Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') throw new PushPermissionError()

      const registration = await navigator.serviceWorker.register(SW_URL)
      await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))
      const body = serializePushSubscription(subscription)
      if (!body) throw new Error('Assinatura push incompleta')
      return apiFetch<PushStatusDTO>('/api/push/subscriptions', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      })
    },
    onSuccess: (data) => {
      setThisDevice(true)
      queryClient.setQueryData(PUSH_KEY, data)
    },
  })

  const disable = useMutation({
    mutationFn: async () => {
      const subscription = await currentSubscription()
      if (!subscription) return status.data ?? null
      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      return apiFetch<PushStatusDTO>('/api/push/subscriptions', {
        method: 'DELETE',
        headers: JSON_HEADERS,
        body: JSON.stringify({ endpoint }),
      })
    },
    onSuccess: (data) => {
      setThisDevice(false)
      if (data) queryClient.setQueryData(PUSH_KEY, data)
    },
  })

  return {
    support,
    permission,
    loading: status.isLoading,
    configured: status.data?.enabled ?? false,
    devices: status.data?.devices ?? 0,
    thisDevice,
    saving: enable.isPending || disable.isPending,
    enable: enable.mutateAsync,
    disable: disable.mutateAsync,
  }
}
