import type { ReactElement, ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { ToastProvider } from "../components/Toast";

// Test-only QueryClient: retries and focus/reconnect refetches make tests slow
// and flaky (a failing query would be retried three times behind fake timers),
// so both are off. `gcTime: Infinity` keeps cached data alive for the whole
// test — the client is thrown away after each render anyway.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  // Pass an existing client to share cache state across re-renders or to seed
  // it with `setQueryData` before rendering. Defaults to a fresh client.
  queryClient?: QueryClient;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
}

// Renders `ui` inside the providers every app component assumes are present:
// a fresh react-query client and the real ToastProvider (so `useToast()` works
// and rendered toasts are assertable).
export function renderWithProviders(
  ui: ReactElement,
  { queryClient = createTestQueryClient(), ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}
