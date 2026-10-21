/** Workers hosts always speak the native WebSocket protocol, even if a static
 * production build was uploaded instead of the Cloudflare-specific build. */
export function usesCloudflare(buildMode, requestedNetwork, hostname) {
  return (
    buildMode === "cloudflare" ||
    requestedNetwork === "websocket" ||
    hostname.endsWith(".workers.dev")
  );
}
