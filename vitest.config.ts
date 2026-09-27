import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
	resolve: {
		alias: {
			"@/lib/brain": resolve(__dirname, "src/brain"),
			"@/routes/brain": resolve(__dirname, "src/routes"),
			"@/config": resolve(__dirname, "src/config/index.ts"),
			"@/types": resolve(__dirname, "src/types.ts"),
			"@/lib": resolve(__dirname, "src/compat/lib"),
			"@/services": resolve(__dirname, "src/compat/services"),
			"@/routes": resolve(__dirname, "src/compat/routes"),
			"@repo/db": resolve(__dirname, "src/db/index.ts"),
			"@repo/db/schema": resolve(__dirname, "src/db/schema/index.ts"),
			"@repo/db/schema/": resolve(__dirname, "src/db/schema/") + "$",
			"@repo/lib": resolve(__dirname, "src/compat/repo-lib"),
			"@repo/lib/": resolve(__dirname, "src/compat/repo-lib/") + "$",
			"@repo/validation": resolve(__dirname, "src/compat/validation"),
			"@repo/validation/": resolve(__dirname, "src/compat/validation/") + "$",
		},
	},
	test: {
		environment: "node",
	},
})
