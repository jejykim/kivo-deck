// Export / import of one preset as a .kivodeck file (JSON with its macros and media embedded)
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { uid, type Macro, type MediaInfo, type Preset } from "./model";
import { mediaBytes, toB64 } from "./media";
import { useApp } from "./state";

interface PresetFile {
  kind: "kivo-deck-preset";
  version: 1;
  preset: Preset;
  macros: Macro[];
  media: { info: MediaInfo; b64: string }[];
}

function collectIds(preset: Preset) {
  const json = JSON.stringify(preset);
  const media = new Set<string>();
  const macros = new Set<string>();
  for (const m of json.matchAll(/"mediaId":"([^"]+)"/g)) media.add(m[1]);
  for (const m of json.matchAll(/"macroId":"([^"]+)"/g)) macros.add(m[1]);
  return { media, macros };
}

export async function exportPreset(preset: Preset) {
  const path = await save({ defaultPath: `${preset.name}.kivodeck`, filters: [{ name: "Kivo Deck 프리셋", extensions: ["kivodeck"] }] });
  if (!path) return;
  const { store } = useApp.getState();
  const ids = collectIds(preset);
  const macros = store.macros.filter((m) => ids.macros.has(m.id));
  // macros can reference media too (sound steps)
  for (const m of macros) for (const x of JSON.stringify(m).matchAll(/"mediaId":"([^"]+)"/g)) ids.media.add(x[1]);
  const media = [];
  for (const id of ids.media) {
    const info = store.media[id];
    if (info) media.push({ info, b64: toB64(await mediaBytes(id)) });
  }
  const file: PresetFile = { kind: "kivo-deck-preset", version: 1, preset, macros, media };
  await invoke("write_text_file", { path, text: JSON.stringify(file) });
}

// Returns the imported preset (new id, os set to `os`); macros and media are merged into the store
export async function importPreset(os: Preset["os"]): Promise<Preset | null> {
  const path = await open({ multiple: false, filters: [{ name: "Kivo Deck 프리셋", extensions: ["kivodeck", "json"] }] });
  if (!path || Array.isArray(path)) return null;
  const file = JSON.parse(await invoke<string>("read_text_file", { path })) as PresetFile;
  if (file.kind !== "kivo-deck-preset") throw new Error("Kivo Deck 프리셋 파일이 아니에요");
  const { store, update } = useApp.getState();
  for (const m of file.media) {
    if (!store.media[m.info.id]) await invoke("save_media", { name: `${m.info.id}.${m.info.ext}`, b64: m.b64 });
  }
  update((s) => {
    for (const m of file.media) s.media[m.info.id] = m.info;
    for (const mac of file.macros) if (!s.macros.some((x) => x.id === mac.id)) s.macros.push(mac);
  });
  return { ...file.preset, id: uid(), os };
}
