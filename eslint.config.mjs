import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".data/**", "node_modules/**", "src/generated/**", "public/sw.js", "next-env.d.ts"] },
  {
    rules: {
      // Never log through console in app code; use the redacting logger.
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  { files: ["scripts/**", "prisma/**", "tests/**"], rules: { "no-console": "off" } },
];
export default config;
