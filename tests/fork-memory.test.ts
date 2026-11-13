import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exposureEvents, intervalDays, memoryStates, practiceEvents, practiceGrade, replay, retrievability, type ReviewEvent } from "../src/core/memory.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

describe("FSRS memory model", () => {
	it("R(S, S) = 90% and the interval at 90% equals S", () => {
		assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
		assert.ok(Math.abs(intervalDays(7) - 7) < 1e-9);
		assert.equal(retrievability(0, 3), 1);
	});
	it("one exposure decays over time", () => {
		const s = replay("n", [{ nodeId: "n", at: T0, grade: 3, source: "exposure" }], T0 + 30 * DAY)!;
		assert.ok(s.retrievability < 0.7, `faded after a month: ${s.retrievability}`);
		const fresh = replay("n", [{ nodeId: "n", at: T0, grade: 3, source: "exposure" }], T0 + DAY)!;
		assert.ok(fresh.retrievability > 0.85);
	});
	it("successful spaced reviews grow stability; a lapse shrinks it", () => {
		const base: ReviewEvent[] = [
			{ nodeId: "n", at: T0, grade: 3, source: "exposure" },
			{ nodeId: "n", at: T0 + 3 * DAY, grade: 3, source: "practice" },
		];
		const good = replay("n", [...base, { nodeId: "n", at: T0 + 12 * DAY, grade: 3, source: "recall" }], T0 + 12 * DAY)!;
		const bad = replay("n", [...base, { nodeId: "n", at: T0 + 12 * DAY, grade: 1, source: "recall" }], T0 + 12 * DAY)!;
		assert.ok(good.stability > bad.stability * 3);
		assert.equal(bad.lapses, 1);
		assert.equal(good.reps, 3);
	});
	it("same-day exposures in one sitting do not inflate stability", () => {
		const once = replay("n", [{ nodeId: "n", at: T0, grade: 3, source: "exposure" }], T0)!;
		const many = replay("n", [0, 1, 2].map((h) => ({ nodeId: "n", at: T0 + h * 3_600_000, grade: 3 as const, source: "exposure" as const })), T0)!;
		assert.equal(many.stability, once.stability);
	});
	it("groups events by node", () => {
		const m = memoryStates([
			{ nodeId: "a", at: T0, grade: 3, source: "exposure" },
			{ nodeId: "b", at: T0, grade: 1, source: "practice" },
		], T0 + 5 * DAY);
		assert.equal(m.size, 2);
		assert.ok(m.get("a")!.retrievability > m.get("b")!.retrievability);
	});
});

describe("evidence derivation", () => {
	it("maps practice outcomes and hint rungs to grades", () => {
		assert.equal(practiceGrade("solved", null), 3);
		assert.equal(practiceGrade("solved", "R3"), 2);
		assert.equal(practiceGrade("solvedWithHints", "R2"), 2);
		assert.equal(practiceGrade("solvedWithHints", "R5"), 1);
		assert.equal(practiceGrade("surrendered", null), 1);
	});
	it("pairs clean problem → conclude calls and skips errored ones", () => {
		const msgs = [
			{ role: "assistant", timestamp: T0, content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { target: ["a", "b"] } }] },
			{ role: "toolResult", toolCallId: "p1", isError: false },
			{ role: "assistant", timestamp: T0 + 1000, content: [{ type: "toolCall", id: "c1", name: "conclude", arguments: { outcome: "solved", rung: null } }] },
			{ role: "assistant", timestamp: T0 + 2000, content: [{ type: "toolCall", id: "p2", name: "problem", arguments: { target: ["c"] } }] },
			{ role: "custom", customType: "problem-dismissed", timestamp: T0 + 3000 },
			{ role: "assistant", timestamp: T0 + 4000, content: [{ type: "toolCall", id: "p3", name: "problem", arguments: { target: ["d"] } }] },
			{ role: "toolResult", toolCallId: "p3", isError: true },
		];
		const ev = practiceEvents(msgs, T0);
		assert.deepEqual(ev.map((e) => [e.nodeId, e.grade]), [["a", 3], ["b", 3], ["c", 1]]);
	});
	it("one exposure per (node, session), dated by the earliest provenance", () => {
		const ev = exposureEvents(
			[{ id: "n", createdAt: new Date(T0).toISOString(), provenance: [{ chatId: "c1", messageId: "m2" }, { chatId: "c1", messageId: "m1" }, { chatId: "c2", messageId: "x" }] }],
			(chat, msg) => ({ "c1/m1": T0, "c1/m2": T0 + 5000, "c2/x": T0 + 9 * DAY } as Record<string, number>)[`${chat}/${msg}`] ?? null,
		);
		assert.deepEqual(ev.map((e) => e.at).sort(), [T0, T0 + 9 * DAY]);
	});
});
