import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    // Agent worktrees live under .claude/ and contain partial checkouts, whose
    // unimplemented contract tests would otherwise fail the trunk's test run.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
  staged: {
    // `vp check` alone let a commit land with failing contract tests, because
    // it only covers format/lint/types. The suite runs in under a second, so
    // there is no reason not to gate on it too.
    // The `sh -c '...' --` wrapper swallows the staged filenames lint-staged
    // appends; without it `vp test` treats them as a filter and reports "no
    // test files found" for a commit that touches no test.
    "*": ["vp check --fix", "sh -c 'vp test --run' --"],
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
