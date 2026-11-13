/**
 * Fork: per-run dictation diagnostics. One small JSON record per dictation
 * run (counts, commit timings, socket closes, errors, the transcript's
 * length and tail) is beaconed to /api/stt/debug at teardown and appended
 * to <data>/debug/dictation.jsonl — so a run that loses text can be
 * explained afterwards. No audio is ever sent.
 */
import type { DictationLanguage } from "@/src/core";

export interface DictationDiag {
	t0: number;
	startedAt: string;
	language: DictationLanguage;
	ua: string;
	sampleRate: number | null;
	sockets: number;
	frames: number;
	framesSent: number;
	framesQueued: number;
	framesDropped: number;
	flushedPending: number;
	forcedCommits: number;
	messages: Record<string, number>;
	commits: Array<{ atMs: number; chars: number }>;
	closes: Array<{ atMs: number; code: number; reason: string; closing: boolean }>;
	errors: string[];
	stopAtMs: number | null;
	canceled: boolean;
	durationMs: number;
	bufferedSegments: number;
	deliveredChars: number;
	tail: string;
}

export function newDictationDiag(language: DictationLanguage, sampleRate: number | null = null): DictationDiag {
	return {
		t0: performance.now(),
		startedAt: new Date().toISOString(),
		language,
		ua: typeof navigator === "undefined" ? "" : navigator.userAgent,
		sampleRate,
		sockets: 0,
		frames: 0,
		framesSent: 0,
		framesQueued: 0,
		framesDropped: 0,
		flushedPending: 0,
		forcedCommits: 0,
		messages: {},
		commits: [],
		closes: [],
		errors: [],
		stopAtMs: null,
		canceled: false,
		durationMs: 0,
		bufferedSegments: 0,
		deliveredChars: 0,
		tail: "",
	};
}

/** RMS of one Int16 PCM frame, in the float domain (0..1). */
export function frameRms(frame: ArrayBuffer | ArrayBufferView): number {
	const samples = ArrayBuffer.isView(frame)
		? new Int16Array(frame.buffer, frame.byteOffset, Math.floor(frame.byteLength / 2))
		: new Int16Array(frame);
	if (samples.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i]! / 32768;
		sum += s * s;
	}
	return Math.sqrt(sum / samples.length);
}

/** Fire-and-forget: survives page unloads (sendBeacon), never throws. */
export function reportDictation(diag: DictationDiag): void {
	try {
		const { t0: _t0, ...record } = diag;
		const body = JSON.stringify(record);
		if (typeof navigator !== "undefined" && navigator.sendBeacon?.("/api/stt/debug", new Blob([body], { type: "application/json" }))) return;
		void fetch("/api/stt/debug", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
	} catch {}
}
