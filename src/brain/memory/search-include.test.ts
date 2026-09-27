import { describe, expect, it } from "vitest"
import { BRAIN_SEARCH_INCLUDE } from "./search-include"

/**
 * Pins the summaries:true flip from the 2026-09-27 privacy-debug report
 * (Bug 2). Without summaries, the LLM sees only vector chunks and over-ranks
 * contextual overview docs over concise marker-style docs, which makes it
 * hedge that "the doc exists but isn't extracted" when in fact the include
 * config is starving it of the extracted summary that contains the answer.
 */

describe("BRAIN_SEARCH_INCLUDE", () => {
	it("surfaces summaries (the canonical model of the extracted doc)", () => {
		expect(BRAIN_SEARCH_INCLUDE.summaries).toBe(true)
	})

	it("keeps vector chunks for retrieval ranking", () => {
		expect(BRAIN_SEARCH_INCLUDE.chunks).toBe(true)
	})

	it("does not return full document bodies (latency cost)", () => {
		expect(BRAIN_SEARCH_INCLUDE.documents).toBe(false)
	})

	it("does not include related or forgotten memories (unrelated context)", () => {
		expect(BRAIN_SEARCH_INCLUDE.relatedMemories).toBe(false)
		expect(BRAIN_SEARCH_INCLUDE.forgottenMemories).toBe(false)
	})
})
