// Server start-up hook: keep a short tail of this instance's warnings and errors for /ops.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordLog } = await import("./lib/ops");
  const g = globalThis as unknown as { __opsHooked?: boolean };
  if (g.__opsHooked) return;
  g.__opsHooked = true;
  const warn = console.warn.bind(console);
  const error = console.error.bind(console);
  console.warn = (...a: unknown[]) => {
    try {
      recordLog("warn", a);
    } catch {
      /* never break logging */
    }
    warn(...a);
  };
  console.error = (...a: unknown[]) => {
    try {
      recordLog("error", a);
    } catch {
      /* never break logging */
    }
    error(...a);
  };
}
