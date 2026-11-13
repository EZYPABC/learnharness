/**
 * Fork: POST { text, context? } → { text, model } — the dictation cleanup
 * pass (src/server/dictation-cleanup.ts). 204-free contract: on any failure
 * the client keeps the raw transcript, so errors are reported, never fatal.
 */
import { cleanTranscript } from "@/src/server/dictation-cleanup";

const MAX_CHARS = 20_000;
const TIMEOUT_MS = 30_000;

export async function POST(req: Request) {
	let body: { text?: unknown; context?: unknown };
	try {
		body = (await req.json()) as typeof body;
	} catch {
		return Response.json({ message: "invalid JSON" }, { status: 400 });
	}
	if (typeof body.text !== "string" || !body.text.trim()) return Response.json({ message: "text required" }, { status: 400 });
	if (body.text.length > MAX_CHARS) return Response.json({ message: "too long" }, { status: 413 });
	const context = typeof body.context === "string" ? body.context : undefined;
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
	req.signal.addEventListener("abort", () => abort.abort(), { once: true });
	try {
		const result = await cleanTranscript(body.text, context, abort.signal);
		if (!result) return Response.json({ message: "no cleanup model configured, or the output was rejected" }, { status: 422 });
		return Response.json(result);
	} catch (e) {
		return Response.json({ message: e instanceof Error ? e.message : "cleanup failed" }, { status: 502 });
	} finally {
		clearTimeout(timer);
	}
}
