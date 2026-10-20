import { createRoot } from "react-dom/client";

async function start() {
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window && (window as any).__TAURI_INTERNALS__.invoke)) {
    (await import("./devmock")).installDevMock();
  }
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(<App />);
}
start();
