import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";
import { subscribeAuth } from "./auth";

// Cache só em memória: notas são dados pessoais e não vão para localStorage.
// Dado "velho" aparece na hora e é revalidado em segundo plano (stale-while-revalidate).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: true,
      // O cliente HTTP já esgota o orçamento de GET em 429/5xx; aqui só há uma repetição de rede.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status) && failureCount < 1,
    },
  },
});

// Ao sair, nada da conta anterior fica em memória.
subscribeAuth((state) => {
  if (state.status === "signed-out") queryClient.clear();
});
