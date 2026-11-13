/**
 * Knowledge decay — the server seam (fork): the live stores bound into the
 * pure snapshot composition (core/memory-snapshot.ts).
 */
import { memorySnapshot, type MemorySnapshot } from "../core/memory-snapshot.ts";
import { stores } from "./stores.ts";

export function memoryView(now = Date.now()): MemorySnapshot {
	return memorySnapshot({ chatStore: stores.chatStore, graphStore: stores.graphStore }, now);
}
