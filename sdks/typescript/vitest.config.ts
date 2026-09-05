/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: process.env.CI ? 1 : undefined,
    testTimeout: 15000,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/tests/crossnet/**",
      "**/tests/infra/production-audit/tests/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/bin/**",
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/global.d.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "./coverage",
    },
  },
});
