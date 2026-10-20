// Drag and drop between the action library and the deck. During dragover the browser hides the
// data, so the item being dragged is also kept here to highlight valid drop targets.
import type { ActionRef, KeyVisual } from "./model";
import { create } from "zustand";

export type DragItem =
  | { kind: "action"; ref: ActionRef; slots: string[] }
  | { kind: "visual"; visual: KeyVisual }
  | { kind: "pickMedia" }; // "이미지 · GIF · 영상" item: opens a file picker on drop

export const useDrag = create<{ item: DragItem | null }>(() => ({ item: null }));

const MIME = "application/x-kivo";

export function startDrag(e: React.DragEvent, item: DragItem) {
  e.dataTransfer.setData(MIME, JSON.stringify(item));
  e.dataTransfer.effectAllowed = "copy";
  useDrag.setState({ item });
}
export function endDrag() {
  useDrag.setState({ item: null });
}
export function readDrop(e: React.DragEvent): DragItem | null {
  const raw = e.dataTransfer.getData(MIME);
  endDrag();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
