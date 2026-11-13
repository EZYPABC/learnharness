"use client";

/**
 * AUTO TEXT DIRECTION (fork): Hebrew/Arabic text renders right-to-left,
 * everything else stays left-to-right, decided per block from its first
 * strong character (the browser's `dir="auto"` algorithm).
 *
 * One window-wide MutationObserver stamps `dir="auto"` on text blocks
 * (paragraphs, list items, headings, quotes, table cells) and on every text
 * field, so rendered markdown, streaming messages and inputs all follow
 * their content without touching each renderer. Code, math and diagrams are
 * never stamped: they stay LTR (see the `.katex` / `pre` rules in globals.css).
 * Elements that already carry an explicit `dir` are left alone.
 */
import * as React from "react";

const TARGETS = "p, h1, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt, figcaption, textarea, input:not([type]), input[type=text], input[type=search], [contenteditable=true], [role=textbox]";
// Lists can't use dir="auto": the algorithm skips descendants that carry
// their own `dir` (the stamped <p> inside each <li>), so a Hebrew list would
// resolve LTR with bullets on the wrong side. Lists get an explicit
// direction computed here, re-evaluated as streamed text arrives.
const LISTS = "ul, ol";
const SKIP = "pre, code, .katex, svg, [data-no-auto-dir]";
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LTR_CHAR = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of the first strong character, ignoring code and math. */
export function firstStrongDir(el: Element): "rtl" | "ltr" | null {
	const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.parentElement?.closest(SKIP)) continue;
		for (const ch of node.textContent ?? "") {
			if (RTL_CHAR.test(ch)) return "rtl";
			if (LTR_CHAR.test(ch)) return "ltr";
		}
	}
	return null;
}

function stampList(el: Element) {
	if (el.closest(SKIP)) return;
	if (el.hasAttribute("dir") && !el.hasAttribute("data-auto-dir")) return;
	const dir = firstStrongDir(el) ?? "ltr";
	if (el.getAttribute("dir") !== dir) el.setAttribute("dir", dir);
	el.setAttribute("data-auto-dir", "");
}

export function stampAutoDir(root: ParentNode): void {
	const stamp = (el: Element) => {
		if (el.hasAttribute("dir") || el.closest(SKIP)) return;
		el.setAttribute("dir", "auto");
	};
	if (root instanceof Element && root.matches(TARGETS)) stamp(root);
	root.querySelectorAll(TARGETS).forEach(stamp);
	// Any other element that directly holds text (titles, chat bubbles,
	// option labels, sidebar rows — divs and spans, not semantic tags).
	// Never inside the composer: its DOM belongs to the editor controller.
	const holder = (el: Element) => {
		if (el.hasAttribute("dir") || el.closest(SKIP) || el.parentElement?.closest("[contenteditable=true]")) return;
		for (const child of el.childNodes) {
			if (child.nodeType === 3 && /\p{L}/u.test(child.textContent ?? "")) { el.setAttribute("dir", "auto"); return; }
		}
	};
	if (root instanceof Element) holder(root);
	root.querySelectorAll("div, span, a, label, button, h1, h2, h3, h4, h5, h6, li, summary").forEach(holder);
	if (root instanceof Element && root.matches(LISTS)) stampList(root);
	root.querySelectorAll(LISTS).forEach(stampList);
}

export default function AutoDir() {
	React.useEffect(() => {
		stampAutoDir(document.body);
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (node instanceof Element) stampAutoDir(node);
					else if (node.nodeType === 3 && node.parentElement) stampAutoDir(node.parentElement);
				}
				// Streaming text: a list's first words may arrive after the list.
				const target = record.target instanceof Element ? record.target : record.target.parentElement;
				const list = target?.closest(LISTS);
				if (list) stampList(list);
			}
		});
		observer.observe(document.body, { childList: true, subtree: true, characterData: true });
		return () => observer.disconnect();
	}, []);
	return null;
}
