"use client"

import { useEffect, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { useLogin } from "@/hooks/use-login"
import { getRoleHome } from "@/lib/role-routes"

/**
 * /login — the only auth UI so far. Posts to /auth/login, on success
 * AuthProvider stores the token and we redirect to the user's
 * role-specific home.
 *
 * The form is uncontrolled: we read the input values out of
 * `FormData` on submit, so there's no per-field React state to keep
 * in sync. This is the right call here because the inputs are
 * "fire and forget" — we never need to read them outside of submit,
 * never need to programmatically clear them, and the only error UI
 * we render is per-field, driven by `error.fieldErrors`.
 */
export default function LoginPage() {
  const router = useRouter()
  const mutation = useLogin()
  const { isAuthenticated, isLoading, user } = useAuth()

  // If the user is authenticated — whether they arrived already
  // logged in or just succeeded at the login mutation — bounce them
  // to their role home. The "already authenticated" case and the
  // "just logged in" case both flip `isAuthenticated`/`user` to the
  // same end state, so a single effect covers both.
  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated && user) {
      router.replace(getRoleHome(user.role))
    }
  }, [isLoading, isAuthenticated, user, router])

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const email = String(formData.get("email") ?? "").trim()
    const password = String(formData.get("password") ?? "")

    if (!email || !password) {
      // Client-side gate so we don't even attempt the call with an
      // obviously empty form. The backend would 422 either way, but
      // this gives instant feedback.
      toast.error("Please enter both email and password.")
      return
    }

    mutation.mutate({ email, password })
  }

  // Field errors come back as { "email": "...", "password": "..." } on
  // a 422. We pull whichever is present (or null) and render below
  // the relevant input. The form-level error path covers 401s and
  // anything else.
  const fieldErrors = mutation.error?.fieldErrors ?? null
  const formError = mutation.error
    ? (typeof mutation.error.detail === "string"
        ? mutation.error.detail
        : mutation.error.message)
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Chowly</CardTitle>
          <CardDescription>
            Use your email and password to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                disabled={mutation.isPending}
                aria-invalid={fieldErrors?.email ? true : undefined}
              />
              {fieldErrors?.email ? (
                <p className="text-sm text-destructive">{fieldErrors.email}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                disabled={mutation.isPending}
                aria-invalid={fieldErrors?.password ? true : undefined}
              />
              {fieldErrors?.password ? (
                <p className="text-sm text-destructive">{fieldErrors.password}</p>
              ) : null}
            </div>

            {formError ? (
              <p
                role="alert"
                className="text-sm text-destructive"
              >
                {formError}
              </p>
            ) : null}

            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
