// The API reference moved to the developer site (/dev/api). Old links keep
// working. The Location is relative on purpose: behind the proxy the request
// URL is the container's own address (0.0.0.0:3000), never the public host.
export function GET() {
  return new Response(null, { status: 308, headers: { Location: '/dev/api' } })
}
