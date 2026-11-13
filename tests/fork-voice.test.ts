import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { elevenLabsLanguage, elevenLabsListenUrl, pcmToBase64 } from "../src/core/dictation.ts";
import { SPEAK_MAX_CHARS, speakableText } from "../src/core/speech-text.ts";

describe("ElevenLabs Scribe realtime URL", () => {
	it("maps locales to ISO-639-1 and omits the code for multilingual", () => {
		assert.equal(elevenLabsLanguage("he"), "he");
		assert.equal(elevenLabsLanguage("en-GB"), "en");
		assert.equal(elevenLabsLanguage("multi"), null);
		const url = new URL(elevenLabsListenUrl("he", "sutkn_x"));
		assert.equal(url.host, "api.elevenlabs.io");
		assert.equal(url.searchParams.get("model_id"), "scribe_v2_realtime");
		assert.equal(url.searchParams.get("audio_format"), "pcm_16000");
		assert.equal(url.searchParams.get("commit_strategy"), "vad");
		assert.equal(url.searchParams.get("language_code"), "he");
		assert.equal(url.searchParams.get("token"), "sutkn_x");
		assert.equal(new URL(elevenLabsListenUrl("multi", "t")).searchParams.has("language_code"), false);
	});
	it("base64-encodes PCM frames", () => {
		assert.equal(pcmToBase64(new Uint8Array([1, 2, 3, 255]).buffer), Buffer.from([1, 2, 3, 255]).toString("base64"));
		const big = new Uint8Array(100_000).map((_, i) => i % 256);
		assert.equal(pcmToBase64(big.buffer), Buffer.from(big).toString("base64"));
	});
});

describe("speakableText", () => {
	it("strips markup and replaces code/math with spoken cues", () => {
		const out = speakableText("## Title\n**Bold** and [link](http://x.y).\n```py\nprint(1)\n```\n$$\\int x$$ and $x$.");
		assert.equal(out.includes("```"), false);
		assert.equal(out.includes("**"), false);
		assert.equal(out.includes("http"), false);
		assert.match(out, /Bold and link/);
		assert.match(out, /code block on screen/);
		assert.match(out, /formula on screen/);
		assert.match(out, /and x\./);
	});
	it("uses Hebrew cues for Hebrew text", () => {
		assert.match(speakableText("זה קוד:\n```js\nx\n```"), /קטע קוד/);
	});
	it("caps the length", () => {
		assert.ok(speakableText("א. ".repeat(5000)).length <= SPEAK_MAX_CHARS);
	});
});
