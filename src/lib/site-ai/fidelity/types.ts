/**
 * Data contract of the fidelity pipeline (docs/site-ai-fidelity.md).
 * Shared by the capture (front A), blueprint (front B) and refine (front C).
 */

export interface CaptureBlock {
  /** Vertical position and size in px, in the capture viewport. */
  y: number
  height: number
  tag: string
  /** Relevant computed styles (colors as #rrggbb, fonts, sizes, radius…). */
  style: Record<string, string>
  /** Short text of the block (analysis only; never copied to the site). */
  text: string
  children?: CaptureBlock[]
}

export interface ReferenceCapture {
  /** Origin + path (no query string, fragment or credentials). */
  url: string
  title: string
  desktop: {
    width: number
    height: number
    /** `data:image/jpeg;base64,…`, at most 1.4M characters each. */
    strips: string[]
    blocks: CaptureBlock[]
  }
  mobile: { width: number; height: number; strips: string[] }
  /** Font families actually used by text, most used first. */
  fonts: string[]
}
