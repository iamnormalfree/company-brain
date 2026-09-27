import { describe, expect, it, vi } from "vitest"
import { createCaptureTools } from "./capture-tools"
import type { TurnCapture } from "./capture-tools"

/**
 * Audit Finding 2: save_memory used to return { saved: true } even when the
 * later writeMemories call would silently bail (e.g. when scope is
 * unknown_channel and slackMemoryWriterUserId returns undefined). That left
 * the user thinking a marker was saved when it wasn't. The fix makes the
 * tool surface the bail-out so the LLM can tell the user.
 */

const capture: TurnCapture = {
	memory: null,
	connect: null,
}

// Build a chainable zod-like stub. The schema chain (`z.array(x).min(1).max(3)`)
// is consumed by ai-sdk for tool input validation, which we don't run here;
// every method returns the proxy so any chain doesn't throw.
const chainableZod = (() => {
	const handler = {
		get(_target: object, _prop: string | symbol) {
			return () => chainableZod
		},
	}
	const chainableZod = new Proxy({}, handler)
	return chainableZod as unknown as { [k: string]: unknown }
})()

const stubDeps = {
	tool: <T>(config: {
		description: string
		inputSchema: unknown
		execute: (args: T) => Promise<unknown>
	}) => ({
		description: config.description,
		inputSchema: config.inputSchema,
		execute: config.execute,
	}),
	z: chainableZod,
	MEMORY_DOCS_PER_TURN_MAX: 3,
	getMcpCatalogSlugs: () => [],
	MAX_BRAIN_MEMORY_DOCS_PER_TURN: 3,
} as unknown as Parameters<typeof createCaptureTools>[0]

// Minimal stub schema for save_memory input — the tool's execute receives `input`
// and checks if `memories` is a key — the easiest path is to pass the MemoryWriteback
// shape directly. We pass `{ memories: doc }` so the inner branch returns the doc.
const doc = {
	title: "Test marker",
	content: "Some test content",
	sources: [],
	tags: [{ key: "topic_test", label: "Test", kind: "topic" as const }],
}

describe("save_memory tool (audit Finding 2: surface bail-out)", () => {
	it("returns { saved: true, ... } when scope is known", async () => {
		const tools = createCaptureTools(stubDeps, capture, "trace-1", {
			allowWrites: true,
			scope: { kind: "dm", channelId: "D-x", userId: "user-1" },
		})
		const saveMemory = tools.save_memory as unknown as {
			execute: (input: unknown) => Promise<unknown>
		}
		const result = await saveMemory.execute({ memories: doc })
		expect(result).toEqual({ saved: true })
	})

	it("returns { saved: false, reason: 'scope_unknown_channel' } when scope is unknown_channel", async () => {
		const tools = createCaptureTools(stubDeps, capture, "trace-2", {
			allowWrites: true,
			scope: { kind: "unknown_channel", channelId: "C-x" },
		})
		const saveMemory = tools.save_memory as unknown as {
			execute: (input: unknown) => Promise<unknown>
		}
		const result = (await saveMemory.execute({ memories: doc })) as {
			saved: boolean
			reason?: string
			message?: string
		}
		expect(result.saved).toBe(false)
		expect(result.reason).toBe("scope_unknown_channel")
		expect(typeof result.message).toBe("string")
		expect(result.message!.length).toBeGreaterThan(0)
	})

	it("does NOT set capture.memory when the save is refused (so the host doesn't try to persist)", async () => {
		const fresh: TurnCapture = { memory: null, connect: null }
		const tools = createCaptureTools(stubDeps, fresh, "trace-3", {
			allowWrites: true,
			scope: { kind: "unknown_channel", channelId: "C-x" },
		})
		const saveMemory = tools.save_memory as unknown as {
			execute: (input: unknown) => Promise<unknown>
		}
		await saveMemory.execute({ memories: doc })
		expect(fresh.memory).toBeNull()
	})

	it("returns no save_memory tool when allowWrites is false", () => {
		const tools = createCaptureTools(stubDeps, capture, "trace-4", {
			allowWrites: false,
			scope: { kind: "dm", channelId: "D-x", userId: "user-1" },
		})
		expect(tools.save_memory).toBeUndefined()
	})

	it("returns { saved: true, ... } when scope is undefined (host's problem to gate elsewhere)", async () => {
		const tools = createCaptureTools(stubDeps, capture, "trace-5", {
			allowWrites: true,
			scope: undefined,
		})
		const saveMemory = tools.save_memory as unknown as {
			execute: (input: unknown) => Promise<unknown>
		}
		const result = await saveMemory.execute({ memories: doc })
		expect(result).toEqual({ saved: true })
	})
})
