/**
 * Fork: auto text direction — composer, rendered blocks and lists pick
 * RTL/LTR from their content; code and math stay LTR.
 */
import { it, describe } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

const dom = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 }, Element: dom.Element });
const { stampAutoDir, firstStrongDir } = await import("../components/auto-dir.tsx");

describe("auto text direction", () => {
	it("stamps dir=auto on text blocks and computes list direction", () => {
		const doc = dom.document;
		doc.body.innerHTML = '<p>שלום</p><p>Hello</p><ul><li><p>פריט</p></li></ul><ol><li>first</li></ol><pre><code><p>x</p></code></pre><p dir="ltr">שלום</p>';
		stampAutoDir(doc.body);
		const ps = doc.querySelectorAll("p");
		assert.equal(ps[0]!.getAttribute("dir"), "auto");
		assert.equal(ps[1]!.getAttribute("dir"), "auto");
		assert.equal(doc.querySelector("ul")!.getAttribute("dir"), "rtl");
		assert.equal(doc.querySelector("ol")!.getAttribute("dir"), "ltr");
		assert.equal(doc.querySelector("pre p")!.hasAttribute("dir"), false, "code untouched");
		assert.equal(ps[ps.length - 1]!.getAttribute("dir"), "ltr", "explicit dir kept");
	});
	it("stamps plain text holders (divs, spans, headings) but not the composer's inner DOM", () => {
		const doc = dom.document;
		doc.body.innerHTML = '<div class="title">שלום עולם</div><div><span>12</span></div><div contenteditable="true"><div>שורה</div></div>';
		stampAutoDir(doc.body);
		const divs = doc.querySelectorAll("body > div");
		assert.equal(divs[0]!.getAttribute("dir"), "auto");
		assert.equal(divs[1]!.hasAttribute("dir"), false, "no letters → untouched");
		assert.equal(divs[2]!.getAttribute("dir"), "auto");
		assert.equal(divs[2]!.querySelector("div")!.hasAttribute("dir"), false);
	});
	it("ignores code and math when finding the first strong character", () => {
		const doc = dom.document;
		doc.body.innerHTML = '<ul><li><code>foo()</code> <span class="katex">x</span> מחזירה ערך</li></ul>';
		assert.equal(firstStrongDir(doc.querySelector("ul")!), "rtl");
	});
});

describe("textDir (title + question direction)", async () => {
	const { textDir } = await import("../src/core/text-dir.ts");
	it("reads the first strong prose character", () => {
		assert.equal(textDir("אני רוצה ללמוד על ריצוף RNA"), "rtl");
		assert.equal(textDir("RNA של תאים בודדים"), "ltr");
		assert.equal(textDir("How do base editors work?"), "ltr");
		assert.equal(textDir("123 …"), null);
		assert.equal(textDir(null), null);
	});
	it("skips code and math before the prose", () => {
		assert.equal(textDir("$x^2$ הוא ריבוע"), "rtl");
		assert.equal(textDir("`foo()` מחזירה ערך"), "rtl");
		assert.equal(textDir("[](https://x.com) שלום"), "rtl");
	});
});
