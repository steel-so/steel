import { cleanup } from '@testing-library/react'

/**
 * Longest delay of the timers `input-otp` schedules on mount without ever
 * clearing them (0, 10 and 50 ms: it re-dispatches `input` and re-reads the
 * selection). Unmounting does not cancel them.
 */
const INPUT_OTP_MOUNT_TIMER_MS = 50

/**
 * For `afterEach` in component tests that render an OTP input. Unmounts,
 * then waits until every timer `input-otp` scheduled during the test has
 * fired. Node runs timers in expiry order, so a timer created now with a
 * longer delay always runs after them. Without this, the last test of a file
 * can end inside that 50 ms window: jsdom is torn down, the timer touches
 * `window` and the run fails with an uncaught `ReferenceError` even though
 * every test passed.
 */
export async function drainInputOtpTimers(): Promise<void> {
  cleanup()
  await new Promise((resolve) =>
    setTimeout(resolve, INPUT_OTP_MOUNT_TIMER_MS + 10),
  )
}
