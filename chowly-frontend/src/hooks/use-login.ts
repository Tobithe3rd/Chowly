"use client"

/**
 * useLogin — React Query mutation wrapping POST /auth/login.
 *
 * On success, the returned `access_token` is handed to AuthProvider's
 * `login()`, which stores it and updates the auth context. From the
 * caller's perspective this is a single `mutate(credentials)` call;
 * the side effect is invisible to them.
 *
 * Errors are NOT cleared here — the mutation object exposes them
 * directly, so the login form can render whatever error UI it wants
 * (and react to the 401 / 422 shapes via `err.detail` /
 * `err.fieldErrors` from lib/api-error).
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query"

import { ApiError } from "@/lib/api-error"
import { apiPost } from "@/lib/api-client"
import { useAuth } from "@/hooks/use-auth"
import type { LoginRequest, TokenResponse } from "@/types"

export function useLogin(): UseMutationResult<TokenResponse, ApiError, LoginRequest> {
  const { login } = useAuth()

  return useMutation<TokenResponse, ApiError, LoginRequest>({
    mutationFn: (credentials) =>
      apiPost<TokenResponse>("/auth/login", credentials),
    onSuccess: (data) => {
      login(data.access_token)
    },
  })
}
