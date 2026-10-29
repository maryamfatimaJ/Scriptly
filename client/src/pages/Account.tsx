import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/Button";
import { useCurrentUser, useLogout, useUpdateProfile } from "@/hooks/useAuth";

export function Account() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const logout = useLogout();
  const updateProfile = useUpdateProfile();
  const [timezone, setTimezone] = useState(user?.timezone ?? "UTC");

  const detectedTimezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl">Account</h1>

      {user ? (
        <div className="mt-8 flex flex-col gap-4">
          <div className="rounded-2xl border border-charcoal/10 p-5">
            <p className="text-sm text-gray">Full name</p>
            <p className="mt-1">{user.fullName}</p>
          </div>
          <div className="rounded-2xl border border-charcoal/10 p-5">
            <p className="text-sm text-gray">Email</p>
            <p className="mt-1">{user.email}</p>
          </div>

          <div className="rounded-2xl border border-charcoal/10 p-5">
            <p className="text-sm text-gray">Timezone</p>
            <p className="mt-1 text-xs text-charcoal/70">
              Reminder times are always computed in this timezone — set it correctly so "8:00 AM" means your 8:00 AM.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Asia/Karachi"
                className="field flex-1"
              />
              <Button variant="secondary" onClick={() => setTimezone(detectedTimezone)}>
                Use {detectedTimezone}
              </Button>
            </div>
            <Button
              className="mt-3"
              onClick={() => updateProfile.mutate({ timezone })}
              disabled={updateProfile.isPending || timezone === user.timezone}
            >
              {updateProfile.isPending ? "Saving…" : "Save timezone"}
            </Button>
            {updateProfile.isError && (
              <p className="mt-2 text-sm text-red-700">{(updateProfile.error as Error).message}</p>
            )}
            {updateProfile.isSuccess && <p className="mt-2 text-sm text-forest">Saved — current: {user.timezone}</p>}
          </div>

          <Button
            variant="secondary"
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/") })}
          >
            Sign out
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-charcoal/70">You're not signed in.</p>
      )}
    </div>
  );
}
