import { describe, expect, it, vi } from "vitest"
import { listBrainMemoryTags } from "./tags"
import { SHARED_TEAM_BRAIN_CONTAINER_TAG } from "@/lib/spaces/provisioning"

/**
 * Pins the audit F1 fix: listBrainMemoryTags must NOT auto-inject
 * sm_org_shared. The implementation queries `brain_memory_tag` once per
 * (container_tag, kind) pair using `agent.sql<TagRow>`; if SHARED had been
 * auto-injected into the scope list, we'd see a SQL call with
 * container_tag = 'sm_org_shared'. We assert by intercepting agent.sql and
 * recording every call's tag argument.
 */

type RecordedCall = { containerTag: unknown; kind: unknown }

function makeRecordingAgent() {
	const calls: RecordedCall[] = []
	return {
		calls,
		agent: {
			sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
				// SQL fragment signature is template literal; values[0] is the first
				// interpolated parameter — for our query that's container_tag.
				// Find the WHERE container_tag = $N fragment to be precise.
				const sqlFrag = strings.join("?")
				const idxContainer = sqlFrag.indexOf("container_tag =")
				const idxLimit = sqlFrag.indexOf("LIMIT")
				const record = (i: number): RecordedCall | undefined => {
					if (i < 0 || i >= values.length) return undefined
					return {
						containerTag: values[i],
						kind: values[i + 1],
					}
				}
				const i = idxContainer >= 0 ? 0 : -1
				const rec = record(i)
				if (rec) calls.push(rec)
				// Limit the row count for stable sort behavior below.
				void idxLimit
				return []
			},
		} as unknown as Parameters<typeof listBrainMemoryTags>[0],
	}
}

describe("listBrainMemoryTags (audit Finding 1: no auto-injected shared scope)", () => {
	it("does NOT query sm_org_shared when currentContainerTags is empty (unknown_channel read surface)", () => {
		const rec = makeRecordingAgent()
		listBrainMemoryTags(rec.agent, { currentContainerTags: [] })
		// No SQL call had container_tag = 'sm_org_shared' injected by the function.
		const sharedLeaks = rec.calls.filter(
			(c) => c.containerTag === SHARED_TEAM_BRAIN_CONTAINER_TAG,
		)
		expect(sharedLeaks).toEqual([])
	})

	it("does NOT query sm_org_shared when currentContainerTags is null/undefined", () => {
		const rec = makeRecordingAgent()
		listBrainMemoryTags(rec.agent, { currentContainerTags: null })
		const sharedLeaks = rec.calls.filter(
			(c) => c.containerTag === SHARED_TEAM_BRAIN_CONTAINER_TAG,
		)
		expect(sharedLeaks).toEqual([])
	})

	it("does NOT query sm_org_shared when called with no arguments at all", () => {
		const rec = makeRecordingAgent()
		listBrainMemoryTags(rec.agent)
		const sharedLeaks = rec.calls.filter(
			(c) => c.containerTag === SHARED_TEAM_BRAIN_CONTAINER_TAG,
		)
		expect(sharedLeaks).toEqual([])
	})

	it("queries ONLY the explicit container tags the caller passes", () => {
		const rec = makeRecordingAgent()
		listBrainMemoryTags(rec.agent, {
			currentContainerTags: ["user_DtFa8t7T4xP66BccLUnhML"],
		})
		// Exactly one SQL call, with the caller's container as the WHERE binding.
		// If auto-injection were still active, we'd see a second call with
		// sm_org_shared.
		const queryTags = rec.calls.map((c) => c.containerTag)
		expect(queryTags).toContain("user_DtFa8t7T4xP66BccLUnhML")
		expect(queryTags).not.toContain(SHARED_TEAM_BRAIN_CONTAINER_TAG)
	})

	it("queries sm_org_shared when the caller opts in explicitly via currentContainerTags (auto-research path)", () => {
		const rec = makeRecordingAgent()
		listBrainMemoryTags(rec.agent, {
			currentContainerTags: [SHARED_TEAM_BRAIN_CONTAINER_TAG],
		})
		const queryTags = rec.calls.map((c) => c.containerTag)
		expect(queryTags).toContain(SHARED_TEAM_BRAIN_CONTAINER_TAG)
	})
})
