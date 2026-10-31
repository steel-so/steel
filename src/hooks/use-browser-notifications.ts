'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  isUrgentNotificationKind,
  notificationKindInfo,
} from '@/src/lib/notification-kind'
import {
  type NotificationStreamEvent,
  useNotificationDelivery,
  useNotificationStreamEvents,
  useUpdateNotificationDelivery,
} from './use-notifications'

/**
 * Desktop notifications for urgent kinds, delivered from the inbox SSE only
 * while the tab is hidden. The per-user switch lives on the server
 * (`/notifications/preferences/delivery`); localStorage is only a cache so
 * the first event after a reload does not wait for the request.
 */

export type BrowserPermission = NotificationPermission | 'unsupported'

const CACHE_KEY = (workspaceId: string) =>
  `steel:notifications:browser:${workspaceId}`

function readCache(workspaceId: string): boolean | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY(workspaceId))
    return raw === null ? null : raw === '1'
  } catch {
    return null
  }
}

function writeCache(workspaceId: string, enabled: boolean) {
  try {
    window.localStorage.setItem(CACHE_KEY(workspaceId), enabled ? '1' : '0')
  } catch {
    // Blocked storage: the server value is the source of truth anyway.
  }
}

export function browserNotificationPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return window.Notification.permission
}

/** Whether an SSE event should raise a desktop notification right now. */
export function shouldNotifyInBrowser(
  event: NotificationStreamEvent,
  state: { enabled: boolean; hidden: boolean; permission: BrowserPermission },
): boolean {
  return (
    state.enabled &&
    state.hidden &&
    state.permission === 'granted' &&
    typeof event.kind === 'string' &&
    isUrgentNotificationKind(event.kind)
  )
}

/** Raises the desktop notification; clicking focuses the tab and navigates. */
export function showBrowserNotification(
  event: NotificationStreamEvent,
  navigate: (href: string) => void,
): void {
  const kind = event.kind ?? ''
  const info = notificationKindInfo(kind)
  const notification = new window.Notification(event.title ?? info.label, {
    body: event.body ?? info.moduleLabel,
    tag: `${kind}:${event.at ?? ''}`,
  })
  notification.onclick = () => {
    window.focus()
    if (event.href) navigate(event.href)
    notification.close()
  }
}

/** Mount once per workspace (header): listens and notifies. */
export function useBrowserNotificationDelivery(
  workspaceId: string | undefined,
  navigate: (href: string) => void,
) {
  const delivery = useNotificationDelivery(workspaceId)
  const serverEnabled = delivery.data?.browserEnabled

  useEffect(() => {
    if (workspaceId && serverEnabled !== undefined) {
      writeCache(workspaceId, serverEnabled)
    }
  }, [workspaceId, serverEnabled])

  useNotificationStreamEvents(workspaceId, (event) => {
    if (!workspaceId) return
    const enabled = serverEnabled ?? readCache(workspaceId) ?? false
    const state = {
      enabled,
      hidden: document.visibilityState === 'hidden',
      permission: browserNotificationPermission(),
    }
    if (shouldNotifyInBrowser(event, state)) {
      showBrowserNotification(event, navigate)
    }
  })
}

/** State and actions of the opt-in switch (inbox and settings). */
export function useBrowserNotificationSetting(workspaceId: string) {
  const delivery = useNotificationDelivery(workspaceId)
  const update = useUpdateNotificationDelivery(workspaceId)
  const [permission, setPermission] = useState<BrowserPermission>('default')

  useEffect(() => {
    setPermission(browserNotificationPermission())
  }, [])

  const enabled =
    (delivery.data?.browserEnabled ?? false) && permission === 'granted'

  const setEnabled = useCallback(
    async (next: boolean): Promise<boolean> => {
      if (next) {
        let current = browserNotificationPermission()
        if (current === 'unsupported') return false
        if (current === 'default') {
          current = await window.Notification.requestPermission()
          setPermission(current)
        }
        if (current !== 'granted') return false
      }
      await update.mutateAsync({ browserEnabled: next })
      writeCache(workspaceId, next)
      return true
    },
    [update, workspaceId],
  )

  return {
    enabled,
    permission,
    loading: delivery.isLoading,
    saving: update.isPending,
    setEnabled,
  }
}
