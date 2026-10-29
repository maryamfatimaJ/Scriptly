import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/Button";
import { useLogin } from "@/hooks/useAuth";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { ApiError } from "@/api/client";

export function Login() {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  function onSubmit(values: LoginInput) {
    loginMutation.mutate(values, { onSuccess: () => navigate("/medications") });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl">Sign in</h1>
      <p className="mt-2 text-charcoal/70">Access your medications, schedule, and prescription history.</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" {...register("email")} className="field" autoComplete="email" />
          {errors.email && <span className="text-xs text-red-700">{errors.email.message}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input type="password" {...register("password")} className="field" autoComplete="current-password" />
          {errors.password && <span className="text-xs text-red-700">{errors.password.message}</span>}
        </label>

        <Button type="submit" className="mt-2" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? "Signing in…" : "Sign in"}
        </Button>

        {loginMutation.isError && (
          <p className="text-sm text-red-700">
            {loginMutation.error instanceof ApiError ? loginMutation.error.message : "Something went wrong."}
          </p>
        )}
      </form>

      <p className="mt-6 text-sm text-charcoal/70">
        Don't have an account?{" "}
        <Link to="/register" className="font-medium text-forest hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}
