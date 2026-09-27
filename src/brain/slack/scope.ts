import type { SlackMemoryScope } from "../memory/writeback"
import type { SlackConversationInfo } from "./client"

export type SlackMemoryScopeInput = {
	isDM: boolean
	channel: string
	channelType?: string
	userId?: string
	slackUserId?: string
	conversationInfo?: SlackConversationInfo
}

/**
 * Decide the memory scope for a Slack turn. Privacy is fail-closed: when
 * neither the event's `channel_type` nor cached `conversationInfo` identifies
 * the conversation as private, we still don't assume it's public — we return
 * `unknown_channel` and let downstream paths refuse to write to sm_org_shared
 * or read from it. DMs go to the asker's personal container as before.
 */
export function slackMemoryScopeForTurn(
	args: SlackMemoryScopeInput,
): SlackMemoryScope {
	const { isDM, channel, channelType, userId, slackUserId, conversationInfo } =
		args
	const base = {
		channelId: channel,
		...(channelType ? { channelType } : {}),
	}
	const scopedUser = userId ? { userId } : {}
	if (isDM) {
		return {
			kind: "dm",
			...base,
			...scopedUser,
			...(slackUserId ? { slackUserId } : {}),
		}
	}

	const explicitPrivate =
		channelType === "group" ||
		channelType === "mpim" ||
		conversationInfo?.isPrivate === true

	const explicitPublic = channelType === "channel"

	if (explicitPrivate) {
		return { kind: "private_channel", ...base, ...scopedUser }
	}
	if (explicitPublic) {
		return { kind: "shared", ...base }
	}

	// unknown scope: route to unknown_channel so save/read bail.
	if (channel) {
		return {
			kind: "unknown_channel",
			channelId: channel,
			...(channelType ? { channelType } : {}),
		}
	}

	return { kind: "unknown_channel", channelId: "" }
}

/**
 * Resolve which supermemory user ID a memory write should be attributed to.
 * Returns undefined for `unknown_channel` so call sites gate on
 * `memoryWriterUserId` and bail instead of writing under an unrelated user's
 * identity.
 */
export function slackMemoryWriterUserId(
	scope: SlackMemoryScope | undefined,
	fallbackUserId: string | undefined,
): string | undefined {
	if (scope?.kind === "dm" || scope?.kind === "private_channel") {
		return scope.userId
	}
	if (scope?.kind === "unknown_channel") {
		return undefined
	}
	return fallbackUserId
}
