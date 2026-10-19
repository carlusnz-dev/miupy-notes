import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-client";
import { expireSession, subscribeAuth } from "./auth";

function onError(error: unknown) {
  if (error instanceof ApiError && error.code === "UNAUTHORIZED") expireSession();
}

// Cache só em memória: notas são dados pessoais e não vão para localStorage.
// Dado "velho" aparece na hora e é revalidado em segundo plano (stale-while-revalidate).
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: true,
      // Erros com status (4xx/5xx da API) não se resolvem repetindo; rede sim, uma vez.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status) && failureCount < 1,
    },
  },
});

// Ao sair, nada da conta anterior fica em memória.
subscribeAuth((state) => {
  if (state.status === "signed-out") queryClient.clear();
});
