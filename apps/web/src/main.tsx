import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAuth } from "./lib/auth";

void initAuth();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
