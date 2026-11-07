import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Security rules from the project rules, enforced as code: a strict CSP is the
// key-theft defence, so anything that turns strings into markup or code is banned.
const noHtmlInjection = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      "dangerouslySetInnerHTML is forbidden: render model output as text or safe markdown.",
  },
  {
    selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]",
    message: "innerHTML/outerHTML are forbidden: build DOM nodes or use React.",
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: "insertAdjacentHTML is forbidden: build DOM nodes or use React.",
  },
  {
    selector:
      "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
    message: "document.write is forbidden.",
  },
];

// anime.js text splitting and scroll debug markers write innerHTML, which Trusted
// Types blocks in production. Split text in React instead.
const animeMessage =
  "This part of anime.js writes innerHTML and breaks under Trusted Types; split text in React.";
const animeUnsafeExports = [
  {
    name: "animejs",
    importNames: [
      "text",
      "split",
      "splitText",
      "scrambleText",
      "TextSplitter",
      "onScroll",
      "ScrollObserver",
    ],
    message: animeMessage,
  },
];
const animeUnsafeModules = [
  { group: ["animejs/text", "animejs/events"], message: animeMessage },
];

// zod probes `new Function` unless jitless is on, and the CSP reports the probe.
const zodMessage =
  "Import z from shared/schemas/zod.ts, which turns on zod's jitless mode for the CSP.";
const zodDirect = [{ name: "zod", message: zodMessage }];
const zodSubpaths = [{ group: ["zod/*"], message: zodMessage }];

// Its default settings round differently and accept floats.
const bigDirect = [
  {
    name: "big.js",
    message:
      "Import decimal from shared/money/decimal.ts, which configures it.",
  },
];

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-design",
    ".wrangler",
    "coverage",
    "playwright-report",
    "test-results",
    "worker-configuration.d.ts",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...noHtmlInjection],
      "no-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [...animeUnsafeExports, ...zodDirect, ...bigDirect],
          patterns: [...animeUnsafeModules, ...zodSubpaths],
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      // TanStack Router's redirect() is thrown by design (a Response, not an Error).
      "@typescript-eslint/only-throw-error": [
        "error",
        {
          allow: [
            {
              from: "package",
              package: "@tanstack/router-core",
              name: "Redirect",
            },
          ],
        },
      ],
    },
  },
  {
    // The one module allowed to import each: it configures it first.
    files: ["shared/schemas/zod.ts", "shared/money/decimal.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: animeUnsafeExports, patterns: animeUnsafeModules },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "design/prototype/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // Plain scripts served to the browser as they are (no bundler).
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  prettier,
]);
