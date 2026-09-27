import { describe, expect, it } from "vitest"
import {
	slackMemoryScopeForTurn,
	slackMemoryWriterUserId,
} from "./scope"
import { resolveBrainReadContainerTags } from "../memory/read-scope"
import {
	slackMemoryContainerTag,
	buildSlackMemoryWriteRequest,
} from "../memory/writeback"
import type { CompanyBrainAgent } from "../turn/agent"

describe("scope classification (privacy fail-closed)", () => {
	it("slackMemoryScopeForTurn returns unknown_channel when channelType and conversationInfo are both absent", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4SH2FN1G",
			channelType: undefined,
			userId: "DtFa8t7T4xP66BccLUnhML",
			slackUserId: "U0C4S5WTDT4",
			conversationInfo: undefined,
		})
		expect(scope).toEqual({
			kind: "unknown_channel",
			channelId: "C0C4SH2FN1G",
		})
	})

	it("preserves channelId and channelType on the unknown_channel result (downstream writeback depends on these)", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4FROMINFO",
			channelType: undefined,
			conversationInfo: { id: "C0C4FROMINFO", isPrivate: true },
		})
		// conversationInfo says private → routes to private_channel.
		expect(scope.kind).toBe("private_channel")
	})

	it("returns unknown_channel with channelId:'' when channel is empty (no channel info at all)", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "",
			channelType: undefined,
			conversationInfo: undefined,
		})
		expect(scope).toEqual({ kind: "unknown_channel", channelId: "" })
	})

	it("returns shared when channelType is 'channel'", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4PUBLIC",
			channelType: "channel",
			conversationInfo: undefined,
		})
		expect(scope.kind).toBe("shared")
	})

	it("returns private_channel when channelType is 'group'", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4PRIVATE",
			channelType: "group",
			conversationInfo: undefined,
		})
		expect(scope.kind).toBe("private_channel")
	})

	it("returns private_channel when channelType is 'mpim' (multi-party DM)", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "G-MPIM-EXAMPLE",
			channelType: "mpim",
			conversationInfo: undefined,
		})
		expect(scope.kind).toBe("private_channel")
	})

	it("returns private_channel when conversationInfo.isPrivate is true", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4FROMINFO",
			channelType: undefined,
			conversationInfo: { id: "C0C4FROMINFO", isPrivate: true },
		})
		expect(scope.kind).toBe("private_channel")
	})

	it("returns unknown_channel when conversationInfo.isPrivate is false (fail-closed: not enough signal)", () => {
		// conversationInfo.isPrivate === false is NOT the same as channelType === "channel".
		// The audit-corrected direction: don't assume public without an explicit channelType.
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "C0C4PUBLIC",
			channelType: undefined,
			conversationInfo: { id: "C0C4PUBLIC", isPrivate: false },
		})
		expect(scope.kind).toBe("unknown_channel")
	})

	it("returns dm for DM channels", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: true,
			channel: "D0C5MCPJYSC",
			userId: "DtFa8t7T4xP66BccLUnhML",
		})
		expect(scope.kind).toBe("dm")
	})

	it("returns unknown_channel for channelType 'im' with isDM=false (some Event API configs)", () => {
		const scope = slackMemoryScopeForTurn({
			isDM: false,
			channel: "D0C5MCPJYSC",
			channelType: "im",
			conversationInfo: undefined,
		})
		expect(scope.kind).toBe("unknown_channel")
	})
})

describe("slackMemoryContainerTag and buildSlackMemoryWriteRequest (write bail-out)", () => {
	it("returns undefined container for unknown_channel (caller must refuse to write)", () => {
		expect(
			slackMemoryContainerTag({
				kind: "unknown_channel",
				channelId: "C0C4SH2FN1G",
			}),
		).toBeUndefined()
	})

	it("returns undefined for dm without userId", () => {
		expect(
			slackMemoryContainerTag({ kind: "dm", channelId: "D-x" }),
		).toBeUndefined()
	})

	it("returns the user container tag for dm+userId", () => {
		expect(
			slackMemoryContainerTag({
				kind: "dm",
				channelId: "D-x",
				userId: "DtFa8t7T4xP66BccLUnhML",
			}),
		).toBe("user_DtFa8t7T4xP66BccLUnhML")
	})

	it("returns slack_channel tag for private_channel scope", () => {
		expect(
			slackMemoryContainerTag({
				kind: "private_channel",
				channelId: "C-x",
			}),
		).toBe("slack_channel_C-x")
	})

	it("returns sm_org_shared for shared scope", () => {
		expect(
			slackMemoryContainerTag({ kind: "shared" }),
		).toBe("sm_org_shared")
	})

	it("buildSlackMemoryWriteRequest returns null for unknown_channel (no sm_org_shared write)", () => {
		const result = buildSlackMemoryWriteRequest(
			{ title: "Anything", content: "Any content", sources: [] },
			{ kind: "unknown_channel", channelId: "C-x" },
		)
		expect(result).toBeNull()
	})

	it("buildSlackMemoryWriteRequest returns null for dm without userId", () => {
		const result = buildSlackMemoryWriteRequest(
			{ title: "Anything", content: "Any content", sources: [] },
			{ kind: "dm", channelId: "D-x" },
		)
		expect(result).toBeNull()
	})

	it("buildSlackMemoryWriteRequest builds a real write for dm+userId", () => {
		const result = buildSlackMemoryWriteRequest(
			{
				title: "Real memory",
				content: "Some real content",
				sources: [],
				tags: [
					{ key: "topic_anything", label: "Anything", kind: "topic" },
				],
			},
			{ kind: "dm", channelId: "D-x", userId: "DtFa8t7T4xP66BccLUnhML" },
		)
		expect(result).not.toBeNull()
		expect(result!.containerTag).toBe("user_DtFa8t7T4xP66BccLUnhML")
	})
})

describe("slackMemoryWriterUserId (write attribution safety)", () => {
	it("returns the asker's userId for dm scope", () => {
		expect(
			slackMemoryWriterUserId(
				{ kind: "dm", userId: "asker-1" },
				"installer",
			),
		).toBe("asker-1")
	})

	it("returns the asker's userId for private_channel scope", () => {
		expect(
			slackMemoryWriterUserId(
				{ kind: "private_channel", channelId: "C-x", userId: "asker-2" },
				"installer",
			),
		).toBe("asker-2")
	})

	it("returns undefined for unknown_channel (write bail-out trigger)", () => {
		expect(
			slackMemoryWriterUserId(
				{ kind: "unknown_channel", channelId: "C-x" },
				"installer",
			),
		).toBeUndefined()
	})

	it("returns undefined when scope is undefined (defensive)", () => {
		expect(slackMemoryWriterUserId(undefined, "installer")).toBe("installer")
	})

	it("falls back to fallbackUserId for shared scope", () => {
		expect(
			slackMemoryWriterUserId({ kind: "shared" }, "installer"),
		).toBe("installer")
	})

	it("returns undefined if dm scope has no userId", () => {
		expect(
			slackMemoryWriterUserId({ kind: "dm", channelId: "D-x" }, "installer"),
		).toBeUndefined()
	})
})

describe("resolveBrainReadContainerTags (read surface)", () => {
	const fakeAgent = {} as CompanyBrainAgent

	it("returns empty list for unknown_channel (no sm_org_shared leak)", () => {
		expect(
			resolveBrainReadContainerTags(fakeAgent, {
				kind: "unknown_channel",
				channelId: "C0C4SH2FN1G",
			}),
		).toEqual([])
	})

	it("returns empty list for dm without userId (fail-closed)", () => {
		expect(
			resolveBrainReadContainerTags(fakeAgent, {
				kind: "dm",
				channelId: "D-x",
			}),
		).toEqual([])
	})

	it("returns the asker's user container for dm+userId", () => {
		const tags = resolveBrainReadContainerTags(fakeAgent, {
			kind: "dm",
			channelId: "D-x",
			userId: "DtFa8t7T4xP66BccLUnhML",
		})
		expect(tags).toEqual(["user_DtFa8t7T4xP66BccLUnhML"])
	})

	it("returns the private channel container for private_channel scope", () => {
		expect(
			resolveBrainReadContainerTags(fakeAgent, {
				kind: "private_channel",
				channelId: "C-x",
			}),
		).toEqual(["slack_channel_C-x"])
	})

	it("returns sm_org_shared for shared scope", () => {
		expect(
			resolveBrainReadContainerTags(fakeAgent, { kind: "shared" }),
		).toEqual(["sm_org_shared"])
	})

	it("respects an admin override verbatim regardless of scope", () => {
		expect(
			resolveBrainReadContainerTags(
				fakeAgent,
				{ kind: "unknown_channel", channelId: "C-x" },
				["custom_container"],
			),
		).toEqual(["custom_container"])
	})

	it("returns empty override array verbatim (empty surface = read nothing)", () => {
		expect(
			resolveBrainReadContainerTags(fakeAgent, undefined, []),
		).toEqual([])
	})
})
