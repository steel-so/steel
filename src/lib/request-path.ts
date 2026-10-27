/**
 * Set by proxy.ts on every request it lets through: the request pathname
 * (no query string), so server code without the `Request` — the workspace
 * layout, `assertIpAllowed` — can tell which page or route was hit. The
 * proxy drops any value the client sent.
 */
export const PATHNAME_REQUEST_HEADER = 'x-steel-pathname'
