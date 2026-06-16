// ESLint 9 flat config. Built on top of `eslint-config-expo` with Prettier
// turned off (Prettier owns formatting; ESLint owns correctness).
const expoConfig = require("eslint-config-expo/flat");
const prettierConfig = require("eslint-config-prettier/flat");

module.exports = [
  ...expoConfig,
  prettierConfig,
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      "dist/**",
      "web-build/**",
      "android-build/**",
      "ios-build/**",
      "build/**",
      "coverage/**",
      ".wrangler/**",
      ".npm-cache/**",
      ".github/**",
      // Supabase Edge Functions run on Deno with `https://esm.sh/...` imports
      // that ESLint can't resolve. Workers are Cloudflare and have their own
      // wrangler-managed tooling. Neither is part of the RN bundle.
      "supabase/**",
      "workers/**",
      "scripts/lib/**",
      "babel.config.js",
      "metro.config.js"
    ]
  },
  {
    rules: {
      // We use react-i18next; raw string literals in JSX are intentional in many
      // places (technical labels, debug overlays) — keep this advisory-only.
      "react/no-unescaped-entities": "off",
      // styled-components legitimately uses `default + named` exports — the
      // pattern `import styled from "styled-components/native"` is correct
      // and the warning is a false positive for this library.
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      // Stylistic preference. Both `T[]` and `Array<T>` are fine.
      "@typescript-eslint/array-type": "off",
      // Files edited on Windows occasionally pick up a UTF-16 BOM. It's
      // harmless at runtime and not worth churning every file for; Prettier
      // (configured with endOfLine: lf) handles new edits going forward.
      "unicode-bom": "off",
      // React Compiler / React 19 strict-purity rules. The existing codebase
      // predates these and uses legitimate patterns (`useRef(Date.now())`,
      // setState in effects for derived state). Keep them advisory so they
      // surface in editor tooling but don't block CI until the codebase has
      // been progressively migrated to React Compiler-compatible patterns.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn"
    }
  }
];
