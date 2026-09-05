"use client"

import { useState, type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30s: avoids hammering the API on every focus/visibility change
        // while still keeping data fresh enough for a demo.
        staleTime: 30_000,
        retry: 1,
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (isServer) {
    // Always create a fresh client on the server so request-state is
    // never shared between users.
    return makeQueryClient()
  }
  // On the client, create once and reuse across re-renders. The
  // module-level `browserQueryClient` survives Fast Refresh because
  // it's not a React state value.
  if (!browserQueryClient) browserQueryClient = makeQueryClient()
  return browserQueryClient
}

export function QueryProvider({ children }: { children: ReactNode }) {
  // useState ensures the client is created exactly once per mount of
  // the provider, even though `getQueryClient` already memoizes on the
  // client. This is the pattern recommended by the React Query docs
  // for Next.js App Router.
  const [queryClient] = useState(() => getQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
