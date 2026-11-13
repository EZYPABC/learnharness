/**
 * KNOWLEDGE DECAY (fork) — a per-proposition memory model over the graph.
 *
 * PURE, browser-safe. The memory state of every proposition is DERIVED from
 * records the harness already keeps, plus one optional explicit log:
 *
 *   exposure   every distinct session that taught/re-encountered the node
 *              (its provenance) counts as one successful review ("good")
 *              at that session's time — the first one is the learning.
 *   practice   problem(target ids) → conclude(outcome, rung) pairs in
 *              practice sessions: the harness's existing mastery trace.
 *   recall     explicit graded checks the agents record with the
 *              record_recall tool (graph/memory-reviews.jsonl).
 *
 * Events replay chronologically through FSRS-5 (Free Spaced Repetition
 * Scheduler, default parameters): stability S (days until recall
 * probability falls to 90%) and difficulty D (1..10). Retrievability at
 * time t after the last review is R = (1 + F·t/S)^C — the forgetting
 * curve the graph fades by and the review queue sorts by.
 *
 * Nothing here writes: no migration, and deleting the explicit log only
 * drops explicit recalls — the derived history is always rebuildable.
 */

export type Grade = 1 | 2 | 3 | 4; // again | hard | good | easy

export type ReviewSource = "exposure" | "practice" | "recall";

export interface ReviewEvent {
	nodeId: string;
	/** Epoch ms. */
	at: number;
	grade: Grade;
	source: ReviewSource;
}

export interface MemoryState {
	nodeId: string;
	/** Days until R falls to 90%. */
	stability: number;
	difficulty: number;
	/** Epoch ms of the last review. */
	lastReview: number;
	reps: number;
	lapses: number;
	/** Recall probability now, 0..1. */
	retrievability: number;
	/** Epoch ms when R reaches the target retention. */
	due: number;
}

const DAY = 86_400_000;
/** FSRS-5 default weights (open-spaced-repetition/fsrs4anki). */
export const FSRS_W = [
	0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
	2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
] as const;
const DECAY = -0.5;
const FACTOR = 19 / 81; // R(S, S) = 0.9
export const TARGET_RETENTION = 0.9;
/** Below this the agents treat a proposition as faded (re-check first). */
export const FADED_THRESHOLD = 0.7;

const w = (i: number) => FSRS_W[i]!;
const clampD = (d: number) => Math.min(10, Math.max(1, d));

export function retrievability(elapsedDays: number, stability: number): number {
	if (elapsedDays <= 0) return 1;
	return Math.pow(1 + (FACTOR * elapsedDays) / Math.max(stability, 0.01), DECAY);
}

/** Days from the last review until R reaches `retention`. */
export function intervalDays(stability: number, retention = TARGET_RETENTION): number {
	return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
}

function initDifficulty(g: Grade): number {
	return clampD(w(4) - Math.exp(w(5) * (g - 1)) + 1);
}

function nextDifficulty(d: number, g: Grade): number {
	const delta = -w(6) * (g - 3);
	const damped = d + (delta * (10 - d)) / 9;
	return clampD(w(7) * initDifficulty(4) + (1 - w(7)) * damped);
}

function recallStability(d: number, s: number, r: number, g: Grade): number {
	const hard = g === 2 ? w(15) : 1;
	const easy = g === 4 ? w(16) : 1;
	return s * (Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy + 1);
}

function forgetStability(d: number, s: number, r: number): number {
	const next = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
	return Math.min(next, s);
}

function shortTermStability(s: number, g: Grade): number {
	return s * Math.exp(w(17) * (g - 3 + w(18)));
}

/** Replay one node's events (any order in, sorted here) → its state at `now`. */
export function replay(nodeId: string, events: readonly ReviewEvent[], now: number): MemoryState | null {
	const sorted = [...events].sort((a, b) => a.at - b.at);
	if (sorted.length === 0) return null;
	let s = 0;
	let d = 0;
	let last = 0;
	let reps = 0;
	let lapses = 0;
	for (const e of sorted) {
		if (reps === 0) {
			s = w(e.grade - 1);
			d = initDifficulty(e.grade);
		} else {
			const elapsed = (e.at - last) / DAY;
			if (elapsed < 1) {
				// Same-day exposures inside one sitting barely move memory;
				// repeated same-session provenance must not inflate stability.
				if (e.source === "exposure") continue;
				s = shortTermStability(s, e.grade);
			} else {
				const r = retrievability(elapsed, s);
				s = e.grade === 1 ? forgetStability(d, s, r) : recallStability(d, s, r, e.grade);
			}
			d = nextDifficulty(d, e.grade);
		}
		if (e.grade === 1 && reps > 0) lapses++;
		reps++;
		last = e.at;
	}
	s = Math.max(s, 0.01);
	return {
		nodeId,
		stability: s,
		difficulty: d,
		lastReview: last,
		reps,
		lapses,
		retrievability: retrievability((now - last) / DAY, s),
		due: last + intervalDays(s) * DAY,
	};
}

export function memoryStates(events: readonly ReviewEvent[], now: number): Map<string, MemoryState> {
	const byNode = new Map<string, ReviewEvent[]>();
	for (const e of events) {
		const list = byNode.get(e.nodeId);
		if (list) list.push(e);
		else byNode.set(e.nodeId, [e]);
	}
	const out = new Map<string, MemoryState>();
	for (const [id, list] of byNode) {
		const state = replay(id, list, now);
		if (state) out.set(id, state);
	}
	return out;
}

// ─── deriving events from the harness's records ─────────────────────────────

/** Practice conclude → grade. The hint-ladder rung measures how much help
 *  retrieval needed; surrender/dismissal is a failed retrieval. */
export function practiceGrade(outcome: string, rung: string | null | undefined): Grade | null {
	if (outcome === "surrendered" || outcome === "dismissed") return 1;
	if (outcome === "movedOn") return 1;
	const level = typeof rung === "string" && /^R[0-5]$/.test(rung) ? Number(rung.slice(1)) : -1;
	if (outcome === "solved") {
		if (level < 0) return 3;
		if (level <= 1) return 3;
		if (level <= 3) return 2;
		return 1;
	}
	if (outcome === "solvedWithHints") return level >= 4 ? 1 : 2;
	return null;
}

interface MinimalBlock {
	type: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}
interface MinimalMessage {
	id?: string;
	role?: string;
	timestamp?: number;
	customType?: string;
	content?: unknown;
	toolCallId?: string;
	isError?: boolean;
}

/** Practice evidence from one chat's native messages: each clean
 *  problem(target) closed by the next conclude (or a dismissal marker). */
export function practiceEvents(messages: readonly MinimalMessage[], fallbackAt: number): ReviewEvent[] {
	const errored = new Set<string>();
	for (const m of messages) if (m.role === "toolResult" && m.isError && m.toolCallId) errored.add(m.toolCallId);
	const out: ReviewEvent[] = [];
	let active: string[] | null = null;
	for (const m of messages) {
		const at = typeof m.timestamp === "number" ? m.timestamp : fallbackAt;
		if (m.role === "custom" && m.customType === "problem-dismissed") {
			if (active) for (const nodeId of active) out.push({ nodeId, at, grade: 1, source: "practice" });
			active = null;
			continue;
		}
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		for (const block of m.content as MinimalBlock[]) {
			if (block.type !== "toolCall" || (block.id && errored.has(block.id))) continue;
			const args = (block.arguments ?? {}) as { target?: unknown; outcome?: unknown; rung?: unknown };
			if (block.name === "problem") {
				active = Array.isArray(args.target) ? args.target.filter((t): t is string => typeof t === "string") : null;
			} else if (block.name === "conclude") {
				const grade = typeof args.outcome === "string" ? practiceGrade(args.outcome, args.rung as string | null) : null;
				if (active && grade) for (const nodeId of active) out.push({ nodeId, at, grade, source: "practice" });
				active = null;
			}
		}
	}
	return out;
}

/** Exposure evidence: one "good" per distinct (node, session), at the
 *  earliest time that session's provenance can be dated. */
export function exposureEvents(
	nodes: ReadonlyArray<{ id: string; createdAt: string; provenance: ReadonlyArray<{ chatId: string; messageId: string }> }>,
	sessionTime: (chatId: string, messageId: string) => number | null,
): ReviewEvent[] {
	const out: ReviewEvent[] = [];
	for (const node of nodes) {
		const firstBySession = new Map<string, number>();
		for (const p of node.provenance) {
			const t = sessionTime(p.chatId, p.messageId);
			if (t === null) continue;
			const prev = firstBySession.get(p.chatId);
			if (prev === undefined || t < prev) firstBySession.set(p.chatId, t);
		}
		if (firstBySession.size === 0) {
			const born = Date.parse(node.createdAt);
			if (Number.isFinite(born)) out.push({ nodeId: node.id, at: born, grade: 3, source: "exposure" });
			continue;
		}
		for (const at of firstBySession.values()) out.push({ nodeId: node.id, at, grade: 3, source: "exposure" });
	}
	return out;
}

/** Human-readable relative age for agents and the UI ("3d", "5w"). */
export function ageLabel(ms: number): string {
	const days = ms / DAY;
	if (days < 1) return `${Math.max(1, Math.round(ms / 3_600_000))}h`;
	if (days < 14) return `${Math.round(days)}d`;
	if (days < 60) return `${Math.round(days / 7)}w`;
	return `${Math.round(days / 30)}mo`;
}

export const GRADE_NAMES: Record<string, Grade> = { again: 1, hard: 2, good: 3, easy: 4 };
