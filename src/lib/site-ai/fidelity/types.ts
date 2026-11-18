export interface CaptureBlock {
  /** Vertical position and size in px in the capture viewport. */
  y: number
  height: number
  tag: string
  /** Relevant computed styles (#rrggbb colors, fonts, sizes, radius…). */
  style: Record<string, string>
  /** Short text of the block (analysis only; never copied). */
  text: string
  children?: CaptureBlock[]
}

export interface ReferenceCapture {
  /** Origin + path. */
  url: string
  title: string
  desktop: {
    width: number
    height: number
    strips: string[]
    blocks: CaptureBlock[]
  }
  mobile: { width: number; height: number; strips: string[] }
  fonts: string[]
  /** `strips` are `data:image/jpeg;base64,…` (at most 1.4M characters each). */
}
