import { expect } from 'vitest'

/**
 * The handful of DOM matchers the public-site component tests use. The repo
 * does not ship @testing-library/jest-dom; importing this file registers
 * them for the test file that imports it.
 */
interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R
  toHaveAttribute(name: string, value?: string): R
  toHaveValue(value: string): R
  toBeEmptyDOMElement(): R
  toHaveTextContent(text: string | RegExp): R
  toHaveClass(name: string): R
}

// Vitest 5 merges custom matchers through `Matchers`, which `Assertion` and
// the asymmetric matchers extend; the type parameters must match its own.
declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends DomMatchers<R> {}
}

const asElement = (received: unknown) =>
  received instanceof Element ? received : null

expect.extend({
  toBeInTheDocument(received: unknown) {
    const el = asElement(received)
    return {
      pass: !!el && el.ownerDocument.contains(el),
      message: () => 'expected the element to be in the document',
    }
  },
  toHaveAttribute(received: unknown, name: string, value?: string) {
    const actual = asElement(received)?.getAttribute(name) ?? null
    return {
      pass: value === undefined ? actual !== null : actual === value,
      message: () =>
        `expected attribute ${name}${value === undefined ? '' : `="${value}"`}, got ${actual}`,
    }
  },
  toHaveValue(received: unknown, value: string) {
    const actual = (received as HTMLInputElement | null)?.value
    return {
      pass: actual === value,
      message: () => `expected value "${value}", got "${actual}"`,
    }
  },
  toBeEmptyDOMElement(received: unknown) {
    const el = asElement(received)
    return {
      pass: !!el && el.innerHTML === '',
      message: () => `expected an empty element, got ${el?.innerHTML}`,
    }
  },
  toHaveTextContent(received: unknown, text: string | RegExp) {
    const actual = asElement(received)?.textContent ?? ''
    return {
      pass:
        typeof text === 'string' ? actual.includes(text) : text.test(actual),
      message: () => `expected text ${String(text)} in "${actual}"`,
    }
  },
  toHaveClass(received: unknown, name: string) {
    return {
      pass: !!asElement(received)?.classList.contains(name),
      message: () => `expected class ${name}`,
    }
  },
})
