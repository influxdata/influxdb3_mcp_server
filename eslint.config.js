import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.js", "**/*.mjs"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        fetch: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",

      "no-console": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "prefer-const": "error",
    },
  },
  {
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/no-var-requires": "off",
    },
  },
  {
    ignores: [
      "build/**",
      "node_modules/**",
      ".claude/worktrees/**",
      "*.config.js",
      "*.config.mjs",
      "*.config.cjs",
    ],
  },
];
