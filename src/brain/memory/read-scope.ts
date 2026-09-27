import { privateContainerTagFor, SHARED_TEAM_BRAIN_CONTAINER_TAG } from "@/lib/spaces/provisioning"
import { privateSlackChannelContainerTag } from "./writeback"
import type { CompanyBrainAgent } from "../turn/agent"
import { type SlackMemoryScope } from "./writeback"

// The container tags a turn may READ from — strictly the container(s) implied
// by the current scope's kind, so a DM cannot surface shared-team or other-
// private-channel memories. The admin-console override replaces the derived set
// (an empty `[]` means read nothing).
export function resolveBrainReadContainerTags(
	agent: CompanyBrainAgent,
	scope: SlackMemoryScope | undefined,
	/** Explicit surface from the admin console; replaces the derived set entirely. */
	override?: string[],
): string[] {
	// An explicit empty surface means read nothing, not fall back to the derived set.
	if (override !== undefined) return [...new Set(override)]
	if (scope?.kind === "dm") {
		return scope.userId ? [privateContainerTagFor(scope.userId)] : []
	}
	if (scope?.kind === "private_channel") {
		return [privateSlackChannelContainerTag(scope.channelId)]
	}
	if (scope?.kind === "unknown_channel") {
		// Fail closed: refuse to surface shared-team memories from a channel we
		// couldn't classify. Better empty than wrong.
		return []
	}
	return [SHARED_TEAM_BRAIN_CONTAINER_TAG]
}
