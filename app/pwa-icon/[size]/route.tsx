import { ImageResponse } from 'next/og'
import { BrandMark } from '../../_og/brand-mark'

const SIZES = new Set([192, 512])

/** Installable-app icons (192 and 512 px) for the web manifest. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ size: string }> },
) {
  const { size: raw } = await ctx.params
  const size = Number(raw)
  if (!SIZES.has(size)) return new Response('Not found', { status: 404 })

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0b0b0c',
      }}
    >
      <BrandMark size={Math.round(size * 0.6)} />
    </div>,
    { width: size, height: size },
  )
}
