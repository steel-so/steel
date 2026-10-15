import type { ReactNode } from 'react'
import {
  SteelRootLayout,
  steelRootMetadata,
} from '../_components/root/steel-root'

export const metadata = steelRootMetadata

/** Root layout of the public screens (sign-in, invites, shared links). */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <SteelRootLayout>{children}</SteelRootLayout>
}
