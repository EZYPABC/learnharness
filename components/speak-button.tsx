"use client";

/**
 * Read-aloud button (fork): 🔊 next to each teacher message. One window-wide
 * player — starting a message stops any other; clicking the playing one
 * stops it. Audio is fetched from /api/tts (ElevenLabs, key server-side)
 * and cached per text for the page's lifetime so replays are free.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Loader2Icon, SquareIcon, Volume2Icon } from "lucide-react";
import { Hint } from "@/components/ui/hint";

type PlayerState = { id: string | null; loading: boolean; error: string | null };
let state: PlayerState = { id: null, loading: false, error: null };
const listeners = new Set<() => void>();
const cache = new Map<string, string>();
let audio: HTMLAudioElement | null = null;
let ticket = 0;

function set(next: Partial<PlayerState>) {
	state = { ...state, ...next };
	for (const l of listeners) l();
}
function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function stopSpeaking() {
	ticket++;
	if (audio) {
		audio.pause();
		audio.src = "";
		audio = null;
	}
	set({ id: null, loading: false });
}

async function speak(id: string, text: string) {
	stopSpeaking();
	const mine = ++ticket;
	set({ id, loading: true, error: null });
	try {
		let url = cache.get(text);
		if (!url) {
			const res = await fetch("/api/tts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text }),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as { message?: string };
				throw new Error(data.message ?? `TTS ${res.status}`);
			}
			url = URL.createObjectURL(await res.blob());
			cache.set(text, url);
		}
		if (mine !== ticket) return;
		const el = new Audio(url);
		audio = el;
		el.addEventListener("ended", () => {
			if (audio === el) stopSpeaking();
		});
		await el.play();
		if (mine === ticket) set({ loading: false });
	} catch (e) {
		if (mine !== ticket) return;
		set({ id: null, loading: false, error: e instanceof Error ? e.message : "Read-aloud failed" });
	}
}

export function SpeakButton({ id, text, className }: { id: string; text: string; className?: string }) {
	const s = useSyncExternalStore(subscribe, () => state, () => state);
	const [showError, setShowError] = useState(false);
	const active = s.id === id;
	useEffect(() => {
		if (!s.error) return;
		setShowError(true);
		const t = setTimeout(() => setShowError(false), 4000);
		return () => clearTimeout(t);
	}, [s.error]);
	if (!text.trim()) return null;
	const label = active ? "Stop reading" : showError && s.error ? s.error : "Read aloud";
	return (
		<Hint label={label} side="top">
			<button
				type="button"
				data-testid="speak-button"
				aria-label={label}
				onClick={() => (active ? stopSpeaking() : void speak(id, text))}
				className={
					"inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground " +
					(active ? "text-foreground " : "") +
					(className ?? "")
				}
			>
				{active && s.loading ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : active ? (
					<SquareIcon className="size-3" />
				) : (
					<Volume2Icon className="size-3.5" />
				)}
			</button>
		</Hint>
	);
}
