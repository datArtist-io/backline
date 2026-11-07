// Layer 1 gates (docs: the bug-finding book, section 4). Type-aware rules run on the engine and the web
// app; the rules chosen are the ones that catch real Backline bug classes: an unawaited tool call
// that fails silently, a hook with a stale dependency, a control without a name.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
import next from "@next/eslint-plugin-next";

export default tseslint.config(
  { ignores: ["launch-film/**", "**/node_modules/**", "**/.next/**", "**/dist/**", "**/playwright-report/**", "**/test-results/**", "scripts/**", "**/*.config.*", "**/next-env.d.ts"] },
  ...tseslint.configs.recommended,
  {
    files: ["packages/engine/src/**/*.ts", "apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y, "@next/next": next },
    rules: {
      // A promise nobody awaits is a tool call whose failure nobody sees.
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false, arguments: false, properties: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      // The React Compiler rules are new and loud on code that mutates refs on purpose (the 3D map);
      // they report, and are reviewed, but do not block until the map code is reworked.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/use-memo": "warn",
      ...jsxA11y.configs.recommended.rules,
      // Focus must move into a dialog when it opens; autoFocus on its close button is the right tool.
      "jsx-a11y/no-autofocus": "off",
      ...next.configs.recommended.rules,
    },
  },
  {
    // Money, prompts and keys live in named places. A price typed anywhere else is a bug (invariant M1).
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/engine/src/**/*.ts"],
    ignores: ["packages/engine/src/skills/trip.ts", "packages/engine/src/skills/trip-travel.ts", "packages/engine/src/skills/flights.ts", "packages/engine/src/clients/**", "apps/web/src/lib/currency.ts", "apps/web/src/lib/env.ts", "packages/engine/src/health.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/^[$€£]\\d[\\d,.]+$/]", message: "A price literal outside the money code (skills/trip.ts, lib/currency.ts). Prices are computed, never typed." },
      ],
    },
  },
);
