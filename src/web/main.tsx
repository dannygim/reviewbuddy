import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initDisplayMode } from "./displayMode";

initDisplayMode();
createRoot(document.getElementById("root")!).render(<App />);
