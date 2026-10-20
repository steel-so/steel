export interface WebphoneCredentialsDTO {
  /** SIP user / extension (ex.: `1122S`). */
  extension: string
  /** SIP secret. Delivered only to the owner's browser, never logged. */
  password: string
  /** SIP domain used in the `aor` and in dialed URIs. */
  domain: string
  /** Secure WebSocket of the PABX (`wss://…`). */
  wssUrl: string
  iceServers: { urls: string[] }[]
}
