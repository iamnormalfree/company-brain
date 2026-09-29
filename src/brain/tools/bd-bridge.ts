import { type ToolSet, tool } from "ai"
import { z } from "zod"

/**
 * bd-bridge tools for kongming.
 *
 * Kongming runs inside Cloudflare Workers (workerd locally) and has no shell.
 * These tools wrap a tiny localhost HTTP bridge (bin/bd-bridge.py) that
 * proxies bd (Steve Yegge Beads) reads. The bridge binds 127.0.0.1 only and
 * requires a bearer token shared via .dev.vars.
 *
 * Authority: docs/adr/2026-09-29-kongming-strategic-context-architecture.md
 * (bd is canonical for current workflow status). Scope: this file is kongming
 * product-local; it is NOT Service-HQ per ADR
 * docs/adr/2026-09-29-service-hq-scope-stays-operational.md.
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const REQUEST_TIMEOUT_MS = 10_000

export type BdBridgeEnv = {
    BD_BRIDGE_URL?: string
    BD_BRIDGE_TOKEN?: string
}

export type BdBridgeToolResult<T> =
    | { ok: true; data: T }
    | { ok: false; status: number; error: string; bridgeOffline: boolean }

async function callBridge<T>(args: {
    env: BdBridgeEnv
    path: string
    query?: Record<string, string | number | undefined>
    traceId: string
    toolName: string
}): Promise<BdBridgeToolResult<T>> {
    const { env, path, query, traceId, toolName } = args
    const base = env.BD_BRIDGE_URL
    const token = env.BD_BRIDGE_TOKEN
    if (!base || !token) {
        console.warn(
            `[kongming][${traceId}] ${toolName} bridge_unconfigured url=${base ? "yes" : "no"} token=${token ? "yes" : "no"}`,
        )
        return {
            ok: false,
            status: 503,
            error:
                "bd bridge not configured (BD_BRIDGE_URL or BD_BRIDGE_TOKEN missing). Tell Brent the bd bridge env vars are missing in .dev.vars.",
            bridgeOffline: true,
        }
    }

    const url = new URL(path, base)
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null) continue
            url.searchParams.set(k, String(v))
        }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
            },
            signal: controller.signal,
        })
        const text = await response.text()
        let payload: unknown = null
        try {
            payload = text ? JSON.parse(text) : null
        } catch {
            return {
                ok: false,
                status: 502,
                error: `bd bridge returned non-JSON (status ${response.status}): ${text.slice(0, 200)}`,
                bridgeOffline: false,
            }
        }
        if (!response.ok) {
            const message =
                (payload && typeof payload === "object" && "error" in payload &&
                    typeof (payload as { error: unknown }).error === "string"
                    ? (payload as { error: string }).error
                    : `bd bridge error (status ${response.status})`)
            return {
                ok: false,
                status: response.status,
                error: message,
                bridgeOffline: response.status === 401 || response.status === 503,
            }
        }
        return { ok: true, data: payload as T }
    } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError"
        console.warn(
            `[kongming][${traceId}] ${toolName} bridge_error url=${url.toString()} reason=${isAbort ? "timeout" : (err as Error).message ?? "unknown"}`,
        )
        return {
            ok: false,
            status: 503,
            error: isAbort
                ? `bd bridge timed out after ${REQUEST_TIMEOUT_MS}ms`
                : `bd bridge unreachable: ${(err as Error).message ?? "unknown error"}. Tell Brent the bd bridge is offline; ask him to paste \`bd ready --json\`.`,
            bridgeOffline: true,
        }
    } finally {
        clearTimeout(timer)
    }
}

function errorToString(result: Exclude<BdBridgeToolResult<unknown>, { ok: true }>): string {
    return result.error
}

function clampLimit(raw: number | undefined): number {
    const n = raw ?? DEFAULT_LIMIT
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
    return Math.min(MAX_LIMIT, Math.floor(n))
}

export function createBdBridgeTools<E extends BdBridgeEnv>(args: {
    env: E
    traceId: string
}): ToolSet {
    const { env, traceId } = args

    const bdReady = tool({
        description:
            "Read currently-ready beads from bd (Steve Yegge Beads). Ready means no open blockers. Use before answering any 'what's next?' / 'what is open?' / priority question. Returns an array of bead objects with id, title, status, priority, dependencies, and notes. THIS TOOL CALLS A LOCAL HTTP BRIDGE, NOT A SHELL — kongming cannot run shell commands. If this returns a connection error, the bd bridge is offline and you should ask Brent to paste `bd ready --json` output instead of guessing.",
        inputSchema: z.object({
            limit: z
                .number()
                .int()
                .min(1)
                .max(MAX_LIMIT)
                .optional()
                .describe(
                    `Maximum number of beads to return. Defaults to ${DEFAULT_LIMIT}. Use a smaller number for focused queries, the max for a full sweep.`,
                ),
        }),
        execute: async ({ limit }) => {
            const result = await callBridge<unknown[]>({
                env,
                path: "/bd/ready",
                query: { limit: clampLimit(limit) },
                traceId,
                toolName: "bd_ready",
            })
            if (!result.ok) {
                return {
                    error: errorToString(result),
                    bridgeOffline: result.bridgeOffline,
                    fallback:
                        "If the bd bridge is offline, ask Brent to paste `bd ready --json` output and answer from the pasted data. Do not invent bead IDs.",
                }
            }
            return {
                count: Array.isArray(result.data) ? result.data.length : 0,
                beads: result.data,
            }
        },
    })

    const bdShow = tool({
        description:
            "Fetch a single bead by id from bd. Use after bd_ready when you need the notes / description / dependency / comment detail for a specific bead. THIS TOOL CALLS A LOCAL HTTP BRIDGE, NOT A SHELL. If the bridge is offline, ask Brent to paste `bd show <id> --json` instead.",
        inputSchema: z.object({
            id: z
                .string()
                .min(1)
                .max(64)
                .describe(
                    "The bd bead id (e.g., 'operate-r4gx' or 'operate-llo9.3'). Must come from a previous bd_ready result or a status doc; never invent.",
                ),
        }),
        execute: async ({ id }) => {
            const result = await callBridge<Record<string, unknown>>({
                env,
                path: "/bd/show",
                query: { id },
                traceId,
                toolName: "bd_show",
            })
            if (!result.ok) {
                return {
                    error: errorToString(result),
                    bridgeOffline: result.bridgeOffline,
                    fallback:
                        "If the bd bridge is offline, ask Brent to paste `bd show <id> --json` output.",
                }
            }
            return result.data
        },
    })

    const bdList = tool({
        description:
            "List beads filtered by status (open, in_progress, closed, all). Use to enumerate in-progress work, or to confirm a bead is closed. THIS TOOL CALLS A LOCAL HTTP BRIDGE, NOT A SHELL. If the bridge is offline, ask Brent to paste `bd list --json --status <status>` output.",
        inputSchema: z.object({
            status: z
                .enum(["open", "in_progress", "closed", "all"])
                .optional()
                .describe(
                    "Filter by status. Defaults to 'open'. Use 'in_progress' for active work, 'closed' for the history.",
                ),
            limit: z
                .number()
                .int()
                .min(1)
                .max(MAX_LIMIT)
                .optional()
                .describe(
                    `Maximum number of beads to return. Defaults to ${DEFAULT_LIMIT}.`,
                ),
        }),
        execute: async ({ status, limit }) => {
            const result = await callBridge<unknown[]>({
                env,
                path: "/bd/list",
                query: { status: status ?? "open", limit: clampLimit(limit) },
                traceId,
                toolName: "bd_list",
            })
            if (!result.ok) {
                return {
                    error: errorToString(result),
                    bridgeOffline: result.bridgeOffline,
                    fallback:
                        "If the bd bridge is offline, ask Brent to paste `bd list --json --status <status>` output.",
                }
            }
            return {
                count: Array.isArray(result.data) ? result.data.length : 0,
                beads: result.data,
            }
        },
    })

    return {
        bd_ready: bdReady,
        bd_show: bdShow,
        bd_list: bdList,
    }
}