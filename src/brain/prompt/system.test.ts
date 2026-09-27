import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "./system"

/**
 * Pins the presence of the prompt rules added for Bugs 4 and 5 of the
 * 2026-09-27 privacy-debug report. These are correctness fixes, not privacy
 * controls; the assertions below are guard-rails against silent prompt
 * regressions.
 */

describe("system prompt rules", () => {
	const prompt = buildSystemPrompt({
		toolMode: "memory_only",
		canRequestAccessLease: false,
		connectedAppRouting: "none",
		allowMemoryWriteback: true,
	})

	it("contains the fail-closed-on-empty-evidence rule (Bug 4)", () => {
		expect(prompt).toContain("do not answer from general knowledge")
	})

	it("contains the refuse-from-general-knowledge example (Bug 4)", () => {
		expect(prompt).toContain("Refuse-from-general-knowledge")
		expect(prompt).toContain("what's the priv-channel marker?")
	})

	it("contains the marker-convention save example (Bug 5)", () => {
		expect(prompt).toContain("Marker convention")
		expect(prompt).toContain("remember that the priv-channel marker is foxtrot")
	})

	it("still preserves the existing thin-evidence example (do not regress)", () => {
		expect(prompt).toContain("Thin evidence.")
		expect(prompt).toContain("did we ever decide on the pricing model")
	})

	it("still preserves the existing save-skip list (do not regress)", () => {
		expect(prompt).toContain("Skip chatter, duplicates, secrets")
	})

	it("still preserves the privacy-by-scope language (do not regress)", () => {
		expect(prompt).toContain("this organization's context")
		expect(prompt).toContain("say plainly when facts are missing")
	})
})
