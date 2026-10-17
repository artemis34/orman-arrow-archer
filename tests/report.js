/** Surface failures in the public Actions summary without requiring log authentication. */
export function annotateFailure(error, title) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const message = String(error.stack || error)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=${title}::${message}`);
}
