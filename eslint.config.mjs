import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

// The frontend/backend boundary: the frontend imports the backend only through backend/index.ts.
const FRONTEND_IMPORTS = {
  patterns: [{ group: ["@/backend/*", "**/backend/*"], message: "The frontend imports the backend only through @/backend (backend/index.ts)." }],
};
const BACKEND_IMPORTS = {
  paths: ["next", "react", "react-dom"].map((name) => ({ name, message: "backend/ is framework-free." })),
  patterns: [
    { group: ["next/*", "react/*", "react-dom/*"], message: "backend/ is framework-free." },
    { group: ["@/app/*", "@/components/*", "@/proxy", "**/app/*", "**/components/*"], message: "backend/ never imports the frontend." },
    { group: ["@/backend", "@/backend/*"], message: "Inside backend/, use relative imports." },
  ],
};

// Only backend/db talks to the database: the rest of the backend goes through scope() and instance() (backend/db/scope.ts).
const DATA_LAYER = {
  paths: [...BACKEND_IMPORTS.paths, { name: "kysely", allowTypeImports: true, message: "Only backend/db talks to the database; use scope() or instance()." }],
  patterns: [
    ...BACKEND_IMPORTS.patterns,
    { group: ["**/db/connect", "**/db/migrations", "**/db/check"], message: "Only backend/db talks to the database; use scope() or instance()." },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**", "components/**", "proxy.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", FRONTEND_IMPORTS] },
  },
  { files: ["backend/**"], rules: { "no-restricted-imports": ["error", BACKEND_IMPORTS] } },
  { files: ["backend/**"], ignores: ["backend/db/**", "backend/testing/**", "**/*.test.ts"], rules: { "no-restricted-imports": ["error", DATA_LAYER] } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated from openapi.json by `npm run generate`; never edited by hand.
    "app/_lib/api/**",
  ]),
  // Last: Prettier does the layout, so no ESLint rule argues with it.
  prettier,
]);

export default eslintConfig;
