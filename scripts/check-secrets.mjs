// A small secrets gate for commits and CI: refuses files that look like they carry a live key. Not a
// replacement for a full scanner, but it stops the common slip (a key pasted into a test or a doc).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic key"],
  [/\bsk-[A-Za-z0-9]{32,}\b/, "OpenAI-style secret key"],
  [/\bgsk_[A-Za-z0-9]{30,}\b/, "Groq key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\beyJhbGciOi[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "JWT (a Supabase service key?)"],
  [/\b(SUPABASE_SERVICE_ROLE_KEY|QLOO_API_KEY|SERPAPI_API_KEY|VAPI_PRIVATE_KEY|RESEND_API_KEY|TAVILY_API_KEY|LITEAPI_API_KEY|DUFFEL_API_KEY)\s*=\s*["']?[A-Za-z0-9_-]{16,}/, "a real key assigned to an env name"],
];
const SKIP = /(^|\/)(package-lock\.json|\.env\.example)$|\.(png|jpg|jpeg|webp|gif|woff2?|ico|mp4|webm)$/;

const files = process.argv.slice(2).length ? process.argv.slice(2) : execSync("git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" }).split("\n").filter(Boolean);
let bad = 0;
for (const f of files) {
  if (SKIP.test(f)) continue;
  let text;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const [re, what] of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const line = text.slice(0, m.index).split("\n").length;
      console.error(`${f}:${line}: looks like ${what}. Move it to an environment variable.`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
