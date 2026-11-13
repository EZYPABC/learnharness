/**
 * Read-aloud (fork): POST { text } → audio/mpeg from ElevenLabs TTS.
 * The key stays server-side (same keys store as dictation). Voice/model
 * are overridable through ELEVENLABS_VOICE_ID / ELEVENLABS_TTS_MODEL.
 */
import { keyValue } from "@/src/server";
import { speakableText } from "@/src/core/speech-text";

const DEFAULT_VOICE = "8sZ9Z3Jy28CGLLCmKEHn"; // Viktor M
const DEFAULT_MODEL = "eleven_v4";
const FALLBACK_MODEL = "eleven_multilingual_v2";

async function synth(key: string, voice: string, model: string, text: string) {
	return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
		method: "POST",
		headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
		body: JSON.stringify({ text, model_id: model }),
	});
}

export async function POST(req: Request) {
	const key = keyValue("ELEVENLABS_API_KEY");
	if (!key) return Response.json({ message: "Read-aloud needs an ElevenLabs key" }, { status: 503 });
	let body: { text?: unknown };
	try {
		body = (await req.json()) as { text?: unknown };
	} catch {
		return Response.json({ message: "invalid JSON" }, { status: 400 });
	}
	if (typeof body.text !== "string") return Response.json({ message: "text required" }, { status: 400 });
	const text = speakableText(body.text);
	if (!text) return Response.json({ message: "nothing to read" }, { status: 400 });
	const voice = keyValue("ELEVENLABS_VOICE_ID") ?? process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE;
	const model = keyValue("ELEVENLABS_TTS_MODEL") ?? process.env.ELEVENLABS_TTS_MODEL ?? DEFAULT_MODEL;
	try {
		let res = await synth(key, voice, model, text);
		// An unknown/retired model id degrades to the multilingual model.
		if (!res.ok && (res.status === 400 || res.status === 422) && model !== FALLBACK_MODEL) {
			res = await synth(key, voice, FALLBACK_MODEL, text);
		}
		if (!res.ok || !res.body) {
			const detail = await res.text().catch(() => "");
			return Response.json({ message: `ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 200)}` }, { status: 502 });
		}
		return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
	} catch {
		return Response.json({ message: "ElevenLabs unreachable" }, { status: 502 });
	}
}
