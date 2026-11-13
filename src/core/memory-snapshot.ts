/**
 * Knowledge decay — composition over the store PORTS (fork). Replays every
 * review event the records imply through the pure FSRS model
 * (core/memory.ts) and answers "how well is each proposition remembered
 * right now". No fs here: the explicit recall log is read through the
 * GraphStore port (graph/memory-reviews.jsonl in the live store).
 */
import { getGraph } from "./graph.ts";
import type { ChatStore, GraphStore } from "./ports.ts";
import {
	FADED_THRESHOLD,
	exposureEvents,
	memoryStates,
	practiceEvents,
	type MemoryState,
	type ReviewEvent,
} from "./memory.ts";

export interface MemoryDeps {
	chatStore: ChatStore;
	graphStore: GraphStore;
}

/** Every review event the records imply, explicit log included. */
export function collectReviewEvents(deps: MemoryDeps): ReviewEvent[] {
	const graph = getGraph(deps.graphStore);
	const chats = deps.chatStore.listChats();
	const messageTimes = new Map<string, Map<string, number>>();
	const chatBorn = new Map<string, number>();
	const events: ReviewEvent[] = [];
	for (const summary of chats) {
		const record = deps.chatStore.getChat(summary.id);
		if (!record) continue;
		const born = Date.parse(record.createdAt);
		chatBorn.set(record.id, Number.isFinite(born) ? born : Date.now());
		const times = new Map<string, number>();
		for (const m of record.messages) {
			const t = (m as { timestamp?: number }).timestamp;
			if (typeof t === "number") times.set(m.id, t);
		}
		messageTimes.set(record.id, times);
		if (record.kind === "practice") events.push(...practiceEvents(record.messages as never, chatBorn.get(record.id)!));
	}
	const sources = new Map(deps.graphStore.readSources().map((s) => [s.id, Date.parse(s.importedAt)]));
	events.push(
		...exposureEvents(graph.nodes, (chatId, messageId) => {
			const t = messageTimes.get(chatId)?.get(messageId);
			if (t !== undefined) return t;
			const born = chatBorn.get(chatId);
			if (born !== undefined) return born;
			const imported = sources.get(chatId);
			return imported !== undefined && Number.isFinite(imported) ? imported : null;
		}),
	);
	events.push(...(deps.graphStore.readMemoryReviews?.() ?? []));
	return events;
}

export interface MemoryEntry extends MemoryState {
	name: string;
	statement: string;
}

export interface MemorySnapshot {
	now: number;
	threshold: number;
	/** nodeId → state, for every proposition in the graph. */
	states: Record<string, MemoryEntry>;
}

export function memorySnapshot(deps: MemoryDeps, now = Date.now()): MemorySnapshot {
	const graph = getGraph(deps.graphStore);
	const states = memoryStates(collectReviewEvents(deps), now);
	const out: Record<string, MemoryEntry> = {};
	for (const node of graph.nodes) {
		const s = states.get(node.id);
		if (!s) continue;
		out[node.id] = { ...s, name: node.name, statement: node.statement };
	}
	return { now, threshold: FADED_THRESHOLD, states: out };
}

/** Lowest-retention first; `limit` caps the list. */
export function fadedEntries(snapshot: MemorySnapshot, opts: { threshold?: number; limit?: number; ids?: ReadonlySet<string> } = {}): MemoryEntry[] {
	const threshold = opts.threshold ?? snapshot.threshold;
	return Object.values(snapshot.states)
		.filter((e) => e.retrievability < threshold && (!opts.ids || opts.ids.has(e.nodeId)))
		.sort((a, b) => a.retrievability - b.retrievability)
		.slice(0, opts.limit ?? 50);
}
