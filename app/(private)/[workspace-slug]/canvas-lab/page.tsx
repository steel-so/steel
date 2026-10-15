import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CanvasLab } from '@/app/_components/canvas/__demo__/canvas-lab'
import { CANVAS_LAB_ENABLED } from '@/lib/env/server'

export const metadata: Metadata = {
  title: 'Canvas Lab | Steel',
  description: 'Playground do editor visual Steel Canvas.',
  robots: { index: false, follow: false },
}

/** Playground of the Steel Canvas shell with the demo catalog. Off in
 * production unless `CANVAS_LAB=true`. */
export default function CanvasLabPage() {
  if (!CANVAS_LAB_ENABLED) notFound()
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col'>
      <CanvasLab />
    </div>
  )
}
