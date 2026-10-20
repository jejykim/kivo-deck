import { editingPage, editingPreset, useApp } from "../state";
import { EmptySlot, PresetBar } from "./PresetBar";
import { PageBar } from "./PageBar";
import { DeckView } from "./DeckView";
import { Inspector } from "./Inspector";
import { MediaDialog } from "./MediaDialog";

export function Editor() {
  const preset = useApp(editingPreset);
  const page = useApp(editingPage);
  const pageIdx = useApp((s) => (preset ? Math.min(s.pageIdx, preset.pages.length - 1) : 0));
  return (
    <main className="editor">
      <PresetBar />
      {preset && page ? (
        <>
          <PageBar />
          <DeckView preset={preset} page={page} pageIdx={pageIdx} />
          <Inspector preset={preset} page={page} />
        </>
      ) : (
        <EmptySlot />
      )}
      <MediaDialog />
    </main>
  );
}
