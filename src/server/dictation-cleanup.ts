/**
 * Fork: dictation cleanup. One cheap, fast model pass over a finished
 * dictation transcript: fixes words the speech-to-text clearly misheard,
 * drops fillers ("אממ", "uh"), repairs punctuation and sentence breaks,
 * and makes the phrasing clear — WITHOUT changing what the speaker meant
 * or answering anything. Model: Claude Haiku through the Claude Code CLI
 * when it is enabled; otherwise the user's cheap model slot.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import { runSubagent } from "../agent/subagents/pi-run.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { getClaudeBinary } from "../agent/claude-code/binary.ts";
import { settingsStore } from "../store/settings.ts";

export const CLEANUP_SYSTEM_PROMPT = `You clean up speech-to-text transcripts of a learner explaining their thinking to a tutor.
The speaker is a genomics bioinformatician; the talk is often Hebrew mixed with English technical terms
(RNA-seq, barcodes, UMI, alignment, variant calling, single-cell, pipelines, p-values …).

Do exactly this, nothing more:
1. Fix words the transcriber clearly got wrong — use the context and the domain (e.g. "אישור של קריאות" → "יישור של קריאות" = read alignment; "קריית וריאנטים" / "בריאת וריאנטים" → "קריאת וריאנטים" = variant calling; also fix misspelled Hebrew words; misheard English terms written in Hebrew letters → the real term in English).
2. Remove fillers, false starts and stutters ("אממ", "אה", "כאילו" used as filler, "uh", "um", repeated words).
3. Fix punctuation: commas, periods, question marks, sentence and paragraph breaks where the speaker paused or changed topic.
4. Make the phrasing clear and readable, keeping the speaker's own words, voice, first person and level of certainty.

Never: answer the question, add ideas, explanations or facts, drop content, summarize, translate the language, or comment.
Keep the original language (Hebrew stays Hebrew; English terms stay English).
If the text is already clean, return it unchanged.
Output ONLY the cleaned text — no preface, no quotes, no notes.`;

/** The cheap slot (the background jobs' model) — the path for non-Claude
 *  setups. Claude Code goes through `haikuViaCli` instead. */
export function cleanupEngine(): PiEngine | undefined {
	const spec = resolveRoleSpec("extractor", settingsStore.readSettings());
	return spec ? piEngineForSpec({ ...spec, thinkingLevel: "off" }, false) : undefined;
}

/** CLI arguments for the one-shot Haiku pass. Measured: the CLI's default
 *  extended thinking spent 6k tokens / ~45s on a 600-char cleanup; with
 *  MAX_THINKING_TOKENS=0 the same call is ~4s. (The app's chat engine
 *  can't go below `--effort low`, which still thinks — hence this path.) */
export function haikuCliArgs(systemPrompt: string): string[] {
	return [
		"-p",
		"--model", "haiku",
		"--system-prompt", systemPrompt,
		"--tools", "",
		"--strict-mcp-config",
		"--setting-sources", "user",
		"--settings", JSON.stringify({ disableAllHooks: true, env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", MAX_THINKING_TOKENS: "0" } }),
		"--disable-slash-commands",
		"--no-session-persistence",
		"--output-format", "json",
	];
}

function haikuViaCli(binary: string, prompt: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, haikuCliArgs(CLEANUP_SYSTEM_PROMPT), {
			cwd: os.tmpdir(),
			env: { ...process.env, MAX_THINKING_TOKENS: "0", CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		const onAbort = () => child.kill();
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (b: Buffer) => out.push(b));
		child.stderr.on("data", (b: Buffer) => err.push(b));
		child.on("error", reject);
		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
			const stdout = Buffer.concat(out).toString("utf8");
			try {
				const json = JSON.parse(stdout) as { result?: string; is_error?: boolean };
				if (code === 0 && !json.is_error && typeof json.result === "string") return resolve(json.result);
				reject(new Error(json.result || `claude exited ${code}`));
			} catch {
				reject(new Error((Buffer.concat(err).toString("utf8") || stdout || `claude exited ${code}`).slice(0, 300)));
			}
		});
		child.stdin.end(prompt, "utf8");
	});
}

export function cleanupPrompt(text: string, context?: string): string {
	const ctx = context?.trim() ? `The tutor's question the speaker is answering (context only — do not answer it):\n<question>\n${context.trim().slice(0, 2000)}\n</question>\n\n` : "";
	return `${ctx}Transcript to clean:\n<transcript>\n${text}\n</transcript>`;
}

/** Guards against a model that answered/summarized instead of cleaning:
 *  a cleanup keeps roughly the transcript's length. */
export function plausibleCleanup(raw: string, cleaned: string): boolean {
	const out = cleaned.trim();
	if (!out) return false;
	const ratio = out.length / Math.max(1, raw.trim().length);
	return ratio > 0.45 && ratio < 1.6;
}

export function stripWrapper(text: string): string {
	return text.trim().replace(/^<transcript>\s*/i, "").replace(/\s*<\/transcript>$/i, "").replace(/^["“”]|["“”]$/g, "").trim();
}

export async function cleanTranscript(text: string, context: string | undefined, signal?: AbortSignal): Promise<{ text: string; model: string } | null> {
	const prompt = cleanupPrompt(text, context);
	const binary = claudeCodeAvailable() ? getClaudeBinary() : null;
	if (binary) {
		const cleaned = stripWrapper(await haikuViaCli(binary, prompt, signal));
		return plausibleCleanup(text, cleaned) ? { text: cleaned, model: `${CLAUDE_CODE_PROVIDER}:haiku` } : null;
	}
	const engine = cleanupEngine();
	if (!engine) return null;
	const { text: out } = await runSubagent([], {
		// Engine is explicit; the role label is only the capture identity.
		role: "extractor",
		engine,
		systemPrompt: CLEANUP_SYSTEM_PROMPT,
		prompt,
		maxTurns: 1,
		abortSignal: signal,
		bypassWorkerRequestAdmission: true,
	});
	const cleaned = stripWrapper(out);
	if (!plausibleCleanup(text, cleaned)) return null;
	return { text: cleaned, model: `${engine.model.provider}:${engine.model.id}` };
}
