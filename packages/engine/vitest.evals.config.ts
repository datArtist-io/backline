import { defineConfig } from "vitest/config";

// The agent evals: `npm run evals` (autopilot baseline, no keys) or `EVAL_MODEL=1 npm run evals`
// (the live model chain from LLM_* in the environment). Cases run one at a time so timings compare.
export default defineConfig({
  test: {
    include: ["evals/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 120_000,
    ...(process.env.EVAL_MODEL === "1" ? {} : { env: { LLM_API_KEY: "", LLM2_API_KEY: "", LLM3_API_KEY: "", TAVILY_API_KEY: "", QLOO_API_KEY: "" } }),
  },
});
