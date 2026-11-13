/** Nova-3 monolingual language codes, including documented locale aliases.
 * Source: https://developers.deepgram.com/docs/models-languages-overview
 * Multilingual is a separate mode; its supported language set differs.
 */
const NOVA_3_LANGUAGES = [
	["Afrikaans", ["af", "af-ZA"]],
	["Arabic", ["ar", "ar-AE", "ar-SA", "ar-QA", "ar-KW", "ar-SY", "ar-LB", "ar-PS", "ar-JO", "ar-EG", "ar-SD", "ar-TD", "ar-MA", "ar-DZ", "ar-TN", "ar-IQ", "ar-IR"]],
	["Armenian", ["hy"]],
	["Assamese", ["as", "as-IN"]],
	["Belarusian", ["be"]],
	["Bengali", ["bn"]],
	["Bosnian", ["bs"]],
	["Bulgarian", ["bg"]],
	["Catalan", ["ca"]],
	["Chinese (Cantonese, Traditional)", ["zh-HK"]],
	["Chinese (Mandarin, Simplified)", ["zh", "zh-CN", "zh-Hans"]],
	["Chinese (Mandarin, Traditional)", ["zh-TW", "zh-Hant"]],
	["Croatian", ["hr"]],
	["Czech", ["cs", "cs-CZ"]],
	["Danish", ["da", "da-DK"]],
	["Dutch", ["nl"]],
	["English", ["en", "en-US", "en-AU", "en-GB", "en-IN", "en-NZ"]],
	["Estonian", ["et"]],
	["Finnish", ["fi"]],
	["Flemish", ["nl-BE"]],
	["French", ["fr", "fr-CA"]],
	["Georgian", ["ka", "ka-GE"]],
	["German", ["de"]],
	["German (Switzerland)", ["de-CH"]],
	["Greek", ["el"]],
	["Gujarati", ["gu", "gu-IN"]],
	["Hebrew", ["he"]],
	["Hindi", ["hi"]],
	["Hungarian", ["hu"]],
	["Indonesian", ["id"]],
	["Italian", ["it"]],
	["Japanese", ["ja"]],
	["Kannada", ["kn"]],
	["Kazakh", ["kk", "kk-KZ"]],
	["Korean", ["ko", "ko-KR"]],
	["Latvian", ["lv"]],
	["Lithuanian", ["lt"]],
	["Macedonian", ["mk"]],
	["Malay", ["ms"]],
	["Marathi", ["mr"]],
	["Mongolian", ["mn"]],
	["Nepali", ["ne"]],
	["Norwegian", ["no"]],
	["Pashto", ["ps", "ps-AF"]],
	["Persian", ["fa"]],
	["Polish", ["pl"]],
	["Portuguese", ["pt", "pt-BR", "pt-PT"]],
	["Punjabi", ["pa", "pa-IN"]],
	["Romanian", ["ro"]],
	["Russian", ["ru"]],
	["Serbian", ["sr"]],
	["Slovak", ["sk"]],
	["Slovenian", ["sl"]],
	["Spanish", ["es", "es-419"]],
	["Swedish", ["sv", "sv-SE"]],
	["Tagalog", ["tl"]],
	["Tamil", ["ta"]],
	["Telugu", ["te"]],
	["Thai", ["th", "th-TH"]],
	["Turkish", ["tr", "tr-TR"]],
	["Ukrainian", ["uk"]],
	["Urdu", ["ur"]],
	["Vietnamese", ["vi"]],
] as const;

export type DictationLanguage = "multi" | (typeof NOVA_3_LANGUAGES)[number][1][number];

export const DICTATION_LANGUAGES: readonly { code: DictationLanguage; label: string }[] = [
	{ code: "multi", label: "Multilingual" },
	...NOVA_3_LANGUAGES.flatMap(([name, codes]) =>
		codes.map((code, i) => ({ code, label: i === 0 ? name : `${name} (${code})` })),
	).sort((a, b) => a.label.localeCompare(b.label, "en")),
];

export function isDictationLanguage(value: unknown): value is DictationLanguage {
	return DICTATION_LANGUAGES.some(({ code }) => code === value);
}

/** Only language varies. Keep the owner's tuned streaming parameters. */
export function deepgramListenUrl(language: DictationLanguage): string {
	return "wss://api.deepgram.com/v1/listen" +
		"?model=nova-3&encoding=linear16&sample_rate=16000&channels=1" +
		"&smart_format=true&punctuate=true&endpointing=300" +
		`&language=${encodeURIComponent(language)}`;
}

/** The speech-to-text engines the token route can mint for. ElevenLabs
 *  Scribe is preferred whenever its key is present (fork: Hebrew-first). */
export type SttEngine = "elevenlabs" | "deepgram";

/** Scribe's language_code is ISO-639-1/3 only: strip the locale suffix;
 *  "multi" means auto-detect (parameter omitted). */
export function elevenLabsLanguage(language: DictationLanguage): string | null {
	if (language === "multi") return null;
	return (language.split("-")[0] ?? language).toLowerCase();
}

/** Scribe v2 realtime: pcm_16000 (our worklet's linear16 16kHz mono),
 *  VAD commits on pauses; the single-use token authenticates the socket. */
export function elevenLabsListenUrl(language: DictationLanguage, token: string): string {
	const params = new URLSearchParams({
		model_id: "scribe_v2_realtime",
		token,
		audio_format: "pcm_16000",
		commit_strategy: "vad",
		// Shorter than the 1.2s we started with: natural breath pauses
		// commit, so fewer segments reach the server's ~35s hard cut.
		vad_silence_threshold_secs: "0.8",
	});
	const code = elevenLabsLanguage(language);
	if (code) params.set("language_code", code);
	return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`;
}

/**
 * Client-side commit pacing (fork). Scribe only commits on a VAD silence;
 * with a room's constant background noise there may be none, and the
 * server then hard-cuts the segment at ~35s — mid-word, garbling the words
 * at the seam. We commit ourselves first: once a segment is SOFT_MS old,
 * at the first quiet frame (well below the recent speech level); at
 * HARD_MS no matter what. Pure: the hook feeds frames, acts on `true`.
 */
export const COMMIT_SOFT_MS = 18_000;
export const COMMIT_HARD_MS = 28_000;
export const FRAME_MS = 128; // 2048 samples @ 16 kHz (the worklet's frame)

export interface CommitPacer {
	/** ms of audio sent since the last commit (ours or the server's). */
	sinceCommitMs: number;
	/** Recent frame levels (≈3s window) for the relative quiet test. */
	recent: number[];
}

export function newCommitPacer(): CommitPacer {
	return { sinceCommitMs: 0, recent: [] };
}

/** Feed one frame's RMS; returns true when a commit should be sent now
 *  (the pacer resets itself in that case). */
export function paceCommit(p: CommitPacer, rms: number): boolean {
	p.sinceCommitMs += FRAME_MS;
	p.recent.push(rms);
	if (p.recent.length > 24) p.recent.shift();
	let commit = false;
	if (p.sinceCommitMs >= COMMIT_HARD_MS) commit = true;
	else if (p.sinceCommitMs >= COMMIT_SOFT_MS && p.recent.length >= 8) {
		const sorted = [...p.recent].sort((a, b) => a - b);
		const speech = sorted[Math.floor(sorted.length * 0.8)] ?? 0; // loud-ish level
		commit = speech > 0 && rms < speech * 0.35;
	}
	if (commit) resetCommitPacer(p);
	return commit;
}

/** A server-side commit landed: the segment clock restarts. */
export function resetCommitPacer(p: CommitPacer): void {
	p.sinceCommitMs = 0;
}

/** Base64 for one PCM frame (browser + node safe, no Buffer). The worklet
 *  posts an Int16Array VIEW, not a raw ArrayBuffer: `new Uint8Array(view)`
 *  would copy element-wise (truncating every sample to one byte, half the
 *  frame) — always read the view's underlying bytes. */
export function pcmToBase64(buffer: ArrayBuffer | ArrayBufferView): string {
	const bytes = ArrayBuffer.isView(buffer)
		? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
		: new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}
