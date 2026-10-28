import {
  Alert02Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import type { StatusTone } from './sending-domain-format'

/** Status pill shared by the domain and its DNS records. */
export function StatusBadge({
  label,
  tone,
}: {
  label: string
  tone: StatusTone
}) {
  if (tone === 'ok') {
    return (
      <Badge variant='default' className='gap-1'>
        <SteelIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={2}
          className='size-3'
        />
        {label}
      </Badge>
    )
  }
  if (tone === 'error') {
    return (
      <Badge variant='destructive' className='gap-1'>
        <SteelIcon icon={Alert02Icon} strokeWidth={2} className='size-3' />
        {label}
      </Badge>
    )
  }
  return <Badge variant='secondary'>{label}</Badge>
}
