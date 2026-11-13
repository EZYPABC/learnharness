import { memoryView } from "@/src/server/memory";
import { fadedEntries } from "@/src/core/memory-snapshot";

/**
 * Knowledge decay (fork): GET → { now, threshold, states } for every graph
 * proposition; ?faded=1 adds the review queue (lowest retention first).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
	const snapshot = memoryView();
	const url = new URL(req.url);
	if (url.searchParams.get("faded")) {
		const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 15));
		return Response.json({ ...snapshot, faded: fadedEntries(snapshot, { limit }) });
	}
	return Response.json(snapshot);
}
