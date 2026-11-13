"use client";

/**
 * Fork: dictation cleanup, client side. After a dictation run ends, the
 * transcript goes through /api/stt/cleanup (Haiku: misheard words,
 * fillers, punctuation) before it lands in the field. A per-device switch
 * (Settings → Keys → Dictation), ON by default. The last run's raw and
 * cleaned text are kept in `lastCleanup` for debugging.
 */
import { useSyncExternalStore } from "react";

const KEY = "lh.dictation.cleanup";
const CLIENT_TIMEOUT_MS = 25_000;
const listeners = new Set<() => void>();

export function dictationCleanupEnabled(): boolean {
	try {
		return localStorage.getItem(KEY) !== "off";
	} catch {
		return true;
	}
}

export function setDictationCleanup(on: boolean): void {
	try {
		localStorage.setItem(KEY, on ? "on" : "off");
	} catch {}
	for (const l of listeners) l();
}

export function useDictationCleanup(): [boolean, (on: boolean) => void] {
	const on = useSyncExternalStore(
		(l) => { listeners.add(l); return () => listeners.delete(l); },
		dictationCleanupEnabled,
		() => true,
	);
	return [on, setDictationCleanup];
}

/** The last run, for "Show original". */
export let lastCleanup: { raw: string; cleaned: string; model: string } | null = null;

/** The tutor's pending question, if one is on screen (context for fixing
 *  domain words — never answered). */
function questionContext(): string | undefined {
	if (typeof document === "undefined") return undefined;
	return document.querySelector("[data-dictation-context]")?.textContent ?? undefined;
}

/** Cleaned text, or the raw text when the pass fails, is rejected, or is slow. */
export async function cleanDictation(raw: string): Promise<string> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), CLIENT_TIMEOUT_MS);
	try {
		const res = await fetch("/api/stt/cleanup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: raw, context: questionContext() }),
			signal: abort.signal,
		});
		if (!res.ok) return raw;
		const body = (await res.json()) as { text?: string; model?: string };
		if (typeof body.text !== "string" || !body.text.trim()) return raw;
		lastCleanup = { raw, cleaned: body.text, model: body.model ?? "" };
		return body.text;
	} catch {
		return raw;
	} finally {
		clearTimeout(timer);
	}
}
