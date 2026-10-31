'use client'

import Link from 'next/link'
import {
  formatSdDate,
  SD_STATE_TONE,
} from '@/app/_components/servicedesk/directory/shared/sd-directory-labels'
import { SdPill } from '@/app/_components/servicedesk/directory/shared/sd-directory-widgets'
import { useSdConfigItemLicenses } from '@/src/hooks/use-sd-licenses'
import { sdLicenseExpiryText } from './sd-license-format'

const EXPIRY_TONE = {
  NONE: SD_STATE_TONE.neutral,
  OK: SD_STATE_TONE.ok,
  EXPIRING: SD_STATE_TONE.warn,
  EXPIRED: SD_STATE_TONE.bad,
} as const

/** Bloco "Licenças de software" do detalhe de um ativo da CMDB. */
export function SdConfigItemLicenses({
  workspaceId,
  slug,
  configItemId,
}: {
  workspaceId: string
  slug: string
  configItemId: string
}) {
  const { data } = useSdConfigItemLicenses(workspaceId, configItemId)
  if (!data || data.length === 0) return null
  return (
    <section className='flex flex-col gap-2'>
      <h4 className='font-semibold text-sm'>Licenças de software</h4>
      <ul className='flex flex-col gap-1.5'>
        {data.map((license) => (
          <li
            key={license.id}
            className='flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm'
          >
            <span className='flex min-w-0 flex-col'>
              <Link
                href={`/${slug}/servicedesk/licenses?record=${license.id}`}
                className='truncate font-medium text-primary underline-offset-2 hover:underline'
              >
                {license.name}
              </Link>
              <span className='truncate text-muted-foreground text-xs'>
                {license.vendor ?? 'Sem fornecedor'}
                {license.expiresAt
                  ? ` · até ${formatSdDate(license.expiresAt)}`
                  : ''}
              </span>
            </span>
            <SdPill className={EXPIRY_TONE[license.expiryState]}>
              {sdLicenseExpiryText(license.expiryState, license.daysLeft)}
            </SdPill>
          </li>
        ))}
      </ul>
    </section>
  )
}
