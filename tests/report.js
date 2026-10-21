/** Surface failures in the public Actions summary without requiring log authentication. */
export function annotateFailure(error, title) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  // Some suites append runtime/gesture diagnostics after the stack is cached.
  const stack = String(error.stack || error);
  const message = (
    stack.includes(error.message) ? stack : `${stack}\n${error.message}`
  )
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error title=${title}::${message}`);
}
