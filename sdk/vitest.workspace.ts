import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
	{
		test: {
			name: "core",
			include: ["src/**/*.test.ts"],
			environment: "node",
		},
	},
	{
		test: {
			name: "integration",
			include: ["tests/integration/**/*.test.ts"],
			environment: "node",
		},
	},
	{
		test: {
			name: "conformance",
			include: ["tests/conformance/**/*.test.ts"],
			environment: "node",
		},
	},
	"examples/*",
]);
