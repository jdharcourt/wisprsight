import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./style.css";

const appearance = matchMedia("(prefers-color-scheme: dark)");
document.documentElement.classList.toggle("dark", appearance.matches);
appearance.addEventListener("change", event => document.documentElement.classList.toggle("dark", event.matches));

createRoot(document.getElementById("root")!).render(<App />);
