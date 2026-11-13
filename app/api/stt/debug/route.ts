/**
 * Fork: dictation run diagnostics sink. POST one JSON record (see
 * components/dictation-diag.ts) → appended to <data>/debug/dictation.jsonl.
 * Capped in size; the file is local to this machine.
 */
import { appendFile, mkdir, stat, rename } from "node:fs/promises";
import path from "node:path";
import { PATHS } from "../../../../config.ts";

const MAX_RECORD = 16_000;
const MAX_FILE = 2_000_000;

export async function POST(req: Request) {
	let text: string;
	try {
		text = await req.text();
		JSON.parse(text);
	} catch {
		return Response.json({ message: "invalid JSON" }, { status: 400 });
	}
	if (text.length > MAX_RECORD) return Response.json({ message: "too large" }, { status: 413 });
	const dir = path.join(/* turbopackIgnore: true */ PATHS.debug);
	const file = path.join(/* turbopackIgnore: true */ dir, "dictation.jsonl");
	await mkdir(dir, { recursive: true });
	try {
		if ((await stat(file)).size > MAX_FILE) await rename(file, `${file}.1`);
	} catch {}
	await appendFile(file, `${JSON.stringify({ at: new Date().toISOString(), ...JSON.parse(text) })}\n`, "utf8");
	return new Response(null, { status: 204 });
}
