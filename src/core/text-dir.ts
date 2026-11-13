/**
 * Fork: text direction from content (pure, browser-safe).
 *
 * The direction of a piece of text is the direction of its first strong
 * character — the Unicode "first strong" rule `dir="auto"` uses — except
 * that markdown code spans, fenced code and LaTeX are skipped: a Hebrew
 * question that opens with `$x$` or `foo()` is still a Hebrew question.
 */

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

export function stripNonProse(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/\$\$[\s\S]*?\$\$/g, " ")
		.replace(/\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, " ")
		.replace(/\$[^$\n]+\$/g, " ")
		.replace(/\]\([^)]*\)/g, "]") // link targets
		.replace(/<[^>]+>/g, " "); // inline html tags
}

/** "rtl" | "ltr" from the first strong prose character; null when none. */
export function textDir(text: string | null | undefined): "rtl" | "ltr" | null {
	if (!text) return null;
	for (const ch of stripNonProse(text)) {
		if (RTL_CHAR.test(ch)) return "rtl";
		if (LTR_CHAR.test(ch)) return "ltr";
	}
	return null;
}
