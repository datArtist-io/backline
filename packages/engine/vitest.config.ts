import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Tests must never hit real APIs: no keys are set in the test environment.
    env: { QLOO_API_KEY: "", LLM_API_KEY: "", TAVILY_API_KEY: "" },
  },
});
