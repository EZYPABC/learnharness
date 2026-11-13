/** Fork: dictation cleanup — prompt shape and the output guards. */
import { it, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanupPrompt, plausibleCleanup, stripWrapper, CLEANUP_SYSTEM_PROMPT } from "../src/server/dictation-cleanup.ts";

describe("dictation cleanup", () => {
	it("wraps the transcript and the optional question context", () => {
		const p = cleanupPrompt("אני חושב ש אממ", "מה המטרה שלך?");
		assert.match(p, /<question>\nמה המטרה שלך\?\n<\/question>/);
		assert.match(p, /<transcript>\nאני חושב ש אממ\n<\/transcript>/);
		assert.doesNotMatch(cleanupPrompt("x", "  "), /<question>/);
	});
	it("forbids answering and demands text-only output", () => {
		assert.match(CLEANUP_SYSTEM_PROMPT, /Never: answer the question/);
		assert.match(CLEANUP_SYSTEM_PROMPT, /Output ONLY the cleaned text/);
	});
	it("rejects outputs that are not a cleanup (answers, summaries, empty)", () => {
		const raw = "אני חושב שהתשובה תלויה בכמה דברים, אממ, קודם כל צריך להבין מה מודדים";
		assert.equal(plausibleCleanup(raw, "אני חושב שהתשובה תלויה בכמה דברים. קודם כל, צריך להבין מה מודדים."), true);
		assert.equal(plausibleCleanup(raw, "כן."), false);
		assert.equal(plausibleCleanup(raw, ""), false);
		assert.equal(plausibleCleanup(raw, raw.repeat(3)), false);
	});
	it("strips a wrapper the model echoed back", () => {
		assert.equal(stripWrapper("<transcript>\nשלום.\n</transcript>"), "שלום.");
		assert.equal(stripWrapper("\"שלום.\""), "שלום.");
	});
});
