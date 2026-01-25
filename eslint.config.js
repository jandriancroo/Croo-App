import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Timezone hardening: Flag raw date patterns that should use timezoneUtils
      // NOTE: These are warnings to catch accidental usage - not blocking
      "no-restricted-syntax": [
        "warn",
        {
          "selector": "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          "message": "Avoid Date.now() in business logic. Use getNowISOString() from timezoneUtils for timestamps."
        },
        {
          "selector": "NewExpression[callee.name='Date'][arguments.length=0]",
          "message": "Avoid raw 'new Date()' in business logic. Use timezone-aware functions from timezoneUtils.ts"
        }
      ]
    },
  },
);
