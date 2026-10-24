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

// EventTarget callbacks and module-level failures can escape a test's try/catch.
// Observe them without intercepting Node's normal error/exit behavior.
if (process.env.GITHUB_ACTIONS === "true")
  process.on("uncaughtExceptionMonitor", (error) =>
    annotateFailure(error, "Uncaught runtime test failure"),
  );
