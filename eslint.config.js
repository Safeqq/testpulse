import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/drizzle/**",
      "**/playwright-report/**",
      "**/node_modules/**",
      "**/coverage/**",
      // StrykerJS: reports and sandbox copies of the sources.
      "**/reports/**",
      "**/.stryker-tmp/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
