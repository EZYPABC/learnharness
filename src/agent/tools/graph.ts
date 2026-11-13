import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { getGraph, graphSessionIndex, graphSessionPropositions } from "../../core/graph.ts";
import type { ChatStore, GraphStore } from "../../core/ports.ts";
import { ageLabel, GRADE_NAMES } from "../../core/memory.ts";
import { fadedEntries, memorySnapshot } from "../../core/memory-snapshot.ts";
import { createPropositionCandidateSearch, propositionCandidateBatch, type CandidateBatch, type CandidateProposition, type CandidateRequest } from "../../core/proposition-candidates.ts";

/**
 * THE PROBER'S GRAPH TOOLS (wave 7, owner-locked 2026-09-23): context
 * injection is dead — zero configuration beyond chat models. The prober
 * reads the learner's persistent knowledge map through two tools instead,
 * replacing the old injected block with on-demand eyes.
 *
 * Names + levels + dating ONLY — no statement text, no session contents
 * (owner ruling: the map's ORGANIZATION is the prober's business, its
 * prose is not). The data comes from Platform's pure core seams
 * (graphSessionIndex / graphSessionPropositions) over the same ports the
 * snapshot reads, so the prober and the learner's graph view can never
 * disagree.
 *
 * Registered on the prober ONLY when the settings gate opens
 * (graphToolsEnabled — the graph master switch AND the agent.graphTools
 * toggle); the composition root decides, the factory just receives the
 * store (absent = the gate is closed, no map tools — tests drive this).
 */

/** What the graph tools close over: the stores the session views read. */
export interface GraphToolContext {
	chatStore: ChatStore;
	graphStore: GraphStore;
}

const listSessionsInput = Type.Object({});

const listPropositionsInput = Type.Object({
	session: Type.String({
		minLength: 1,
		description: "The session's id exactly as list_sessions reported it (a chat id or a notes source id)",
	}),
});

export function proberGraphTools(ctx: GraphToolContext): Record<string, AgentTool<any>> {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	return {
		list_sessions: {
			name: "list_sessions",
			label: "list_sessions",
			description:
				"List the sessions of the learner's persistent knowledge graph — every chat or imported-notes file that ever contributed a proposition, most recent first. The map is organized into birth-session clusters (propositions grouped by the session they were first learned in), and session names are those clusters' labels. " +
				"Each line: the session's name, kind (chat/file), how many propositions were born in it, its dates, and its id — use that id with list_propositions. " +
				"Reading this first shows what he has already covered and when, before you probe anything.",
			parameters: listSessionsInput,
			execute: serverExecute("list_sessions", listSessionsInput, async (): Promise<string> => {
				const sessions = graphSessionIndex(deps);
				if (sessions.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
				const lines = sessions.map((s, i) =>
					`${i + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}, ` +
					`born ${s.createdAt ?? "unknown date"}${s.updatedAt ? `, last active ${s.updatedAt}` : ""}) — id: ${s.id}`,
				);
				return `${sessions.length} session(s) in the knowledge graph, most recent first:\n${lines.join("\n")}`;
			}),
		},
		list_propositions: {
			name: "list_propositions",
			label: "list_propositions",
			description:
				"List the propositions BORN in one knowledge-graph session — what was covered there. " +
				"Names only — no statement text, no session contents (owner ruling 2026-09-23: the map's ORGANIZATION is your business, its prose is not).",
			parameters: listPropositionsInput,
			execute: serverExecute("list_propositions", listPropositionsInput, async ({ session }): Promise<string> => {
				const propositions = graphSessionPropositions(deps, session);
				if (propositions.length === 0) {
					return `No propositions born in session "${session}". Call list_sessions for the current ids.`;
				}
				// Fork (knowledge decay): each line carries current retention + id.
				const memory = memorySnapshot(deps);
				const lines = propositions.map((p) => {
					const m = memory.states[p.nodeId];
					return m ? `- ${p.name} [${p.nodeId}] — retention ${Math.round(m.retrievability * 100)}%` : `- ${p.name} [${p.nodeId}]`;
				});
				return `${propositions.length} proposition(s) covered in this session:\n${lines.join("\n")}`;
			}),
		},
		...memoryTools(ctx),
	};
}

// ─── knowledge decay tools (fork) ───────────────────────────────────────────

const fadedInput = Type.Object({
	threshold: Type.Optional(Type.Number({ minimum: 0.05, maximum: 0.99, description: "Retention cutoff, 0..1 (default 0.7)." })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Max propositions to list (default 25)." })),
});

const recordRecallInput = Type.Object({
	reviews: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1, description: "Proposition id (the [n_…] id from list_propositions / faded_propositions)." }),
			grade: Type.Union([Type.Literal("again"), Type.Literal("hard"), Type.Literal("good"), Type.Literal("easy")], {
				description: "again = could not retrieve it / wrong; hard = retrieved with real effort or partial; good = retrieved correctly; easy = instant and fluent.",
			}),
		}),
		{ minItems: 1, maxItems: 50 },
	),
});

/** Read the decayed map and write graded recall evidence. Shared by the
 *  prober (measure: re-check faded prerequisites) and practice. */
export function memoryTools(ctx: GraphToolContext): Record<string, AgentTool<any>> {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	return {
		faded_propositions: {
			name: "faded_propositions",
			label: "faded_propositions",
			description:
				"List the learner's propositions whose estimated recall probability has decayed below a threshold (spaced-repetition model over his history: teaching sessions, practice outcomes, recorded recall checks). " +
				"Lowest retention first. Each line: name, id, retention %, time since last review, review count. " +
				"Something he learned once but has likely forgotten must be re-checked before anything is built on it.",
			parameters: fadedInput,
			execute: serverExecute("faded_propositions", fadedInput, async ({ threshold, limit }): Promise<string> => {
				const snap = memorySnapshot(deps);
				const total = Object.keys(snap.states).length;
				if (total === 0) return "The knowledge graph has no propositions yet — nothing to decay.";
				const faded = fadedEntries(snap, { threshold, limit: limit ?? 25 });
				if (faded.length === 0) return `None of the ${total} propositions is below ${Math.round((threshold ?? snap.threshold) * 100)}% retention.`;
				const lines = faded.map(
					(e) =>
						`- ${e.name} [${e.nodeId}] — retention ${Math.round(e.retrievability * 100)}%, last reviewed ${ageLabel(snap.now - e.lastReview)} ago, ${e.reps} review(s)${e.lapses ? `, ${e.lapses} lapse(s)` : ""}`,
				);
				return `${faded.length} faded proposition(s) of ${total}:\n${lines.join("\n")}`;
			}),
		},
		record_recall: {
			name: "record_recall",
			label: "record_recall",
			description:
				"Record how well the learner just retrieved one or more EXISTING graph propositions (by id), after a question that actually required recalling them. " +
				"This updates the spaced-repetition memory model (decay + next review). Grade honestly from his answer and thinking; never record for material he was just told.",
			parameters: recordRecallInput,
			execute: serverExecute("record_recall", recordRecallInput, async ({ reviews }): Promise<string> => {
				const known = new Set(getGraph(deps.graphStore).nodes.map((n) => n.id));
				const valid = reviews.filter((r) => known.has(r.id));
				const unknown = reviews.filter((r) => !known.has(r.id)).map((r) => r.id);
				const at = Date.now();
				deps.graphStore.appendMemoryReviews?.(valid.map((r) => ({ nodeId: r.id, at, grade: GRADE_NAMES[r.grade]!, source: "recall" as const })));
				const snap = memorySnapshot(deps);
				const after = valid.map((r) => {
					const m = snap.states[r.id];
					return m ? `- ${m.name}: next review in ${ageLabel(Math.max(0, m.due - snap.now))}` : `- ${r.id}`;
				});
				return `Recorded ${valid.length} recall(s).${unknown.length ? ` Unknown ids skipped: ${unknown.join(", ")}.` : ""}${after.length ? "\n" + after.join("\n") : ""}`;
			}),
		},
	};
}

// ─── the auditor's graph tools (2026-09-27 relink) ───────────────────────────

/**
 * THE AUDITOR'S TOOLSET — the extraction auditor explores the graph to
 * place new propositions instead of receiving it injected (owner ruling
 * 2026-09-27: a full-graph dump bloats context as the graph grows; the
 * auditor looks up identity candidates itself). Auditor-specific
 * versions, deliberately different from the prober's:
 *
 *   find_candidates   batched, ranked lexical lookup using the proposed
 *                     findings themselves; five candidates per finding,
 *                     explicit pagination, full statements and matched
 *                     aliases, deduplicated within the returned batch.
 *   list_sessions     the birth-session index, no timestamps.
 *   list_propositions full proposition text (optional exploration fallback).
 *
 * No timestamps anywhere: identity work needs content, not chronology.
 * Read-only, pure core seams, same ports the snapshot reads.
 */

export interface AuditorCandidateBatch {
	matches: Array<{ propositionId: string; candidateIds: string[]; nextCursor: string | null }>;
	candidates: CandidateBatch["candidates"];
}

interface CandidateLookup {
	id: string;
	hints?: readonly string[];
	cursor?: string;
}

/** Prepare the first page in code, and keep all continuations bound to this
 * audit's immutable queries. A new search cannot accidentally inherit an old
 * offset. Tokens are opaque, per-audit and stable when a request is repeated;
 * none of this suppresses previously returned records. */
export function prepareAuditorReview(ctx: GraphToolContext, propositions: readonly CandidateProposition[] = []): {
	initialCandidates: AuditorCandidateBatch;
	tools: Record<string, AgentTool<any>>;
} {
	const deps = { chatStore: ctx.chatStore, graphStore: ctx.graphStore };
	const findInput = Type.Object({
		propositions: Type.Array(Type.Object({
			id: Type.String({ minLength: 1, description: "An id from the proposed findings. Its name, statement and aliases are searched automatically." }),
			hints: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
				description: "Optional alternative words or phrases to add to the search. Plain text, not glob patterns.",
			})),
			cursor: Type.Optional(Type.String({ minLength: 1, description: "Continue a previous query with its nextCursor. Do not supply hints with a cursor; its query is already fixed. Omit cursor to start a new search at its first page." })),
		}, { additionalProperties: false }), { minItems: 1, description: "Look up only findings needing a specific additional search. Include each id once." }),
	}, { additionalProperties: false });
	let search: ReturnType<typeof createPropositionCandidateSearch> | undefined;
	const continuations = new Map<string, CandidateRequest>();
	const tokens = new Map<string, string>();
	function lookup(requests: readonly CandidateLookup[]): AuditorCandidateBatch {
		const queries = requests.map((request): CandidateRequest => {
			if (request.cursor === undefined) return { id: request.id, hints: request.hints ? [...request.hints] : undefined };
			if (request.hints !== undefined) throw new Error("A continuation already fixes its query. Omit hints, or omit cursor to start a new search.");
			const query = continuations.get(request.cursor);
			if (!query || query.id !== request.id) throw new Error("Unknown cursor for this finding and audit. Start a fresh lookup without cursor.");
			return query;
		});
		search ??= createPropositionCandidateSearch(getGraph(deps.graphStore).nodes);
		const batch = propositionCandidateBatch(search, propositions, queries);
		return {
			matches: batch.matches.map((match, index) => {
				let nextCursor: string | null = null;
				if (match.nextOffset !== null) {
					const query = { ...queries[index]!, offset: match.nextOffset };
					const key = JSON.stringify([query.id, query.hints ?? [], query.offset]);
					nextCursor = tokens.get(key) ?? randomUUID();
					tokens.set(key, nextCursor);
					continuations.set(nextCursor, query);
				}
				return { propositionId: match.propositionId, candidateIds: match.candidateIds, nextCursor };
			}),
			candidates: batch.candidates,
		};
	}
	const initialCandidates = lookup([...new Set(propositions.map((proposition) => proposition.id))].map((id) => ({ id })));
	const tools: Record<string, AgentTool<any>> = {
		find_candidates: {
			name: "find_candidates",
			label: "find_candidates",
			description:
				"Find existing proposition candidates for a batch of proposed ids, using their full text and optional hints. " +
				"Ranks word overlap across names, statements and aliases, not exact phrases or glob patterns. " +
				"The first page is already in your input. A new search returns five ranked candidates; nextCursor continues that exact query. " +
				"Each candidate's full statement and relevant matched aliases appear once in candidates; matches lists its ids per finding. " +
				"An unmatched finding can remain new; a continuation is an option, not a requirement to keep searching. " +
				"There is no cross-call suppression: repeating a request returns its full page again.",
			parameters: findInput,
			execute: serverExecute("find_candidates", findInput, async (input) => lookup(input.propositions)),
		},
		list_sessions: {
			name: "list_sessions",
			label: "list_sessions",
			description:
				"List the knowledge graph's birth sessions — every chat or imported-notes file that ever contributed a proposition. " +
				"Each line: name, kind, proposition count, id. Use the id with list_propositions to see what a session covered.",
			parameters: Type.Object({}),
			execute: serverExecute("list_sessions", Type.Object({}), async (): Promise<string> => {
				const sessions = graphSessionIndex(deps);
				if (sessions.length === 0) return "The knowledge graph is empty — no session has contributed propositions yet.";
				const lines = sessions.map((s, i) => `${i + 1}. ${s.name} (${s.kind}, ${s.propositions} proposition${s.propositions === 1 ? "" : "s"}) — id: ${s.id}`);
				return `${sessions.length} session(s):\n${lines.join("\n")}`;
			}),
		},
		list_propositions: {
			name: "list_propositions",
			label: "list_propositions",
			description:
				"List the propositions BORN in one session, with FULL statement text — the content-level view for identity work " +
				"(deciding whether a new proposition is really one of these).",
			parameters: listPropositionsInput,
			execute: serverExecute("list_propositions", listPropositionsInput, async ({ session }): Promise<string> => {
				const propositions = graphSessionPropositions(deps, session);
				if (propositions.length === 0) return `No propositions born in session "${session}". Call list_sessions for the current ids.`;
				const nodes = new Map(getGraph(deps.graphStore).nodes.map((n) => [n.id, n]));
				const lines = propositions.map((p) => {
					const node = nodes.get(p.nodeId);
					return `- ${p.nodeId} :: ${p.name}\n  statement: ${node?.statement ?? "(unknown)"}`;
				});
				return `${propositions.length} proposition(s) born in this session:\n${lines.join("\n")}`;
			}),
		},
	};
	return { initialCandidates, tools };
}
