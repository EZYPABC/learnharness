/**
 * POST-less BYOK mint: the renderer never holds a real STT key.
 *
 * Fork: two engines. ElevenLabs Scribe v2 realtime is preferred whenever
 * ELEVENLABS_API_KEY is set (single-use token, 15 min, consumed on the
 * socket handshake); Deepgram stays as the fallback engine (short-lived
 * JWT via /auth/grant, needs ≥ Member permission). Audio flows renderer →
 * provider directly, never through this server.
 */
import { keyValue } from "@/src/server";

async function elevenLabsToken(key: string): Promise<Response> {
	try {
		const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
			method: "POST",
			headers: { "xi-api-key": key },
			body: "", // ElevenLabs requires Content-Length (411 otherwise)
		});
		if (!res.ok) {
			const detail = await res.text();
			return Response.json(
				{ message: `ElevenLabs token failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		const data = (await res.json()) as { token?: string };
		if (!data.token) return Response.json({ message: "ElevenLabs returned no token" }, { status: 502 });
		return Response.json({ token: data.token, engine: "elevenlabs" });
	} catch {
		return Response.json({ message: "ElevenLabs unreachable" }, { status: 502 });
	}
}

async function deepgramToken(key: string): Promise<Response> {
	try {
		const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
			method: "POST",
			headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ttl_seconds: 300 }),
		});
		if (!res.ok) {
			const detail = await res.text();
			return Response.json(
				{ message: `Deepgram token grant failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		const data = (await res.json()) as { access_token?: string };
		if (!data.access_token) {
			return Response.json({ message: "Deepgram grant returned no token" }, { status: 502 });
		}
		return Response.json({ token: data.access_token, engine: "deepgram" });
	} catch {
		return Response.json({ message: "Deepgram unreachable" }, { status: 502 });
	}
}

export async function GET() {
	const eleven = keyValue("ELEVENLABS_API_KEY");
	if (eleven) return elevenLabsToken(eleven);
	const deepgram = keyValue("DEEPGRAM_API_KEY");
	if (deepgram) return deepgramToken(deepgram);
	return Response.json(
		{ message: "No ELEVENLABS_API_KEY or DEEPGRAM_API_KEY — add one in Settings → Keys." },
		{ status: 503 },
	);
}
