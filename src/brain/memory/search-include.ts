/**
 * Include flags passed to supermemory on every search hit. Pinned as a
 * module-scope constant so a future revert doesn't silently re-introduce
 * the "topic exists but doc not extracted" starvation (2026-09-27 debug,
 * Bug 2). Turning summaries off drops the canonical model of marker-style
 * docs and over-ranks contextual overview docs in the chunk signal.
 *
 * Documents stay off by default — summaries are what the LLM needs to
 * cite cleanly without dragging the full doc body into context.
 */
export const BRAIN_SEARCH_INCLUDE = {
	documents: false,
	summaries: true,
	relatedMemories: false,
	forgottenMemories: false,
	chunks: true,
} as const
