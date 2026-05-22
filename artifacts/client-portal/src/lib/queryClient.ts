import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat data as fresh for 60s — aligned with the admin pages'
      // refetchInterval so remounts/navigation within a single poll cycle
      // don't trigger an extra "surprise" refetch on top of polling.
      staleTime: 60_000,
      // Don't refetch on every window focus — surprise refetches were the
      // main reason the admin felt like it was "refreshing constantly".
      refetchOnWindowFocus: false,
    },
  },
});
