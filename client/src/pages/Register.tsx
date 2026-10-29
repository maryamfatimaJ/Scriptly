import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/Button";
import { useRegister } from "@/hooks/useAuth";
import { registerSchema, type RegisterInput } from "@/lib/validation/auth";
import { ApiError } from "@/api/client";

export function Register() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  function onSubmit(values: RegisterInput) {
    // Detected automatically so reminder times are correct from the first
    // schedule — never guessed on the backend, just the browser's own
    // reported zone, and the user can change it later in Account settings.
    const timezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
    registerMutation.mutate({ ...values, timezone }, { onSuccess: () => navigate("/medications") });
  }

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl">Create your account</h1>
      <p className="mt-2 text-charcoal/70">Start organizing your prescriptions in one place.</p>

      <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
        <label className="flex flex-col gap-1 text-sm">
          Full name
          <input {...register("fullName")} className="field" autoComplete="name" />
          {errors.fullName && <span className="text-xs text-red-700">{errors.fullName.message}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Email
          <input type="email" {...register("email")} className="field" autoComplete="email" />
          {errors.email && <span className="text-xs text-red-700">{errors.email.message}</span>}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Password
          <input type="password" {...register("password")} className="field" autoComplete="new-password" />
          {errors.password && <span className="text-xs text-red-700">{errors.password.message}</span>}
        </label>

        <Button type="submit" className="mt-2" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? "Creating account…" : "Create account"}
        </Button>

        {registerMutation.isError && (
          <p className="text-sm text-red-700">
            {registerMutation.error instanceof ApiError ? registerMutation.error.message : "Something went wrong."}
          </p>
        )}
      </form>

      <p className="mt-6 text-sm text-charcoal/70">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-forest hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
