import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./core/registry.ts";
import "./ui/app.css";
import { App } from "./ui/App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
