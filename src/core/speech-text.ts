/**
 * Markdown → speakable plain text for read-aloud (fork: ElevenLabs TTS).
 * PURE, browser-safe. A TTS voice reading "$\frac{a}{b}$" or a code fence
 * aloud is noise, so formulas/code become short spoken placeholders and
 * markup is stripped. The text is capped (TTS bills per character).
 */

export const SPEAK_MAX_CHARS = 4500;

/** Placeholders are language-aware: Hebrew-dominant text gets Hebrew cues. */
function isHebrew(text: string): boolean {
	const he = (text.match(/[\u0590-\u05FF]/g) ?? []).length;
	const latin = (text.match(/[A-Za-z]/g) ?? []).length;
	return he > latin;
}

export function speakableText(markdown: string): string {
	const he = isHebrew(markdown);
	const cue = {
		code: he ? " (קטע קוד מופיע במסך) " : " (code block on screen) ",
		formula: he ? " (נוסחה במסך) " : " (formula on screen) ",
		diagram: he ? " (תרשים במסך) " : " (diagram on screen) ",
	};
	let t = markdown;
	t = t.replace(/```mermaid[\s\S]*?```/g, cue.diagram);
	t = t.replace(/```[\s\S]*?```/g, cue.code);
	t = t.replace(/\$\$[\s\S]*?\$\$/g, cue.formula);
	t = t.replace(/\\\[[\s\S]*?\\\]/g, cue.formula);
	// Short inline math reads fine as its bare symbols; long ones get the cue.
	t = t.replace(/\$([^$\n]{1,200})\$/g, (_, body: string) => (body.length <= 12 && !/\\/.test(body) ? body : cue.formula));
	t = t.replace(/\\\(([\s\S]*?)\\\)/g, cue.formula);
	t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
	t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	t = t.replace(/<[^>]+>/g, " ");
	t = t.replace(/https?:\/\/\S+/g, " ");
	t = t.replace(/`([^`]+)`/g, "$1");
	t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
	t = t.replace(/^\s*>\s?/gm, "");
	t = t.replace(/^\s*[-*+]\s+/gm, "");
	t = t.replace(/^\s*\|?[-:\s|]+\|[-:\s|]*$/gm, "");
	t = t.replace(/\|/g, ", ");
	t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
	t = t.replace(/(\*|_)([^*_\n]+)\1/g, "$2");
	t = t.replace(/~~(.*?)~~/g, "$1");
	t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
	if (t.length > SPEAK_MAX_CHARS) {
		const cut = t.lastIndexOf(".", SPEAK_MAX_CHARS);
		t = t.slice(0, cut > SPEAK_MAX_CHARS * 0.6 ? cut + 1 : SPEAK_MAX_CHARS);
	}
	return t;
}
