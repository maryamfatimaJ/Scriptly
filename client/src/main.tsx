import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { CapsuleIntro } from "@/animations/CapsuleIntro";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Mounted once, above the router, so switching pages never
            remounts (and therefore never replays) the intro. */}
        <CapsuleIntro>
          <App />
        </CapsuleIntro>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
