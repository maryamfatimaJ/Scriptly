import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as authApi from "@/api/auth";
import { ApiError } from "@/api/client";

const CURRENT_USER_KEY = ["auth", "me"];

export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: async () => {
      try {
        const { user } = await authApi.getCurrentUser();
        return user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => authApi.login(email, password),
    onSuccess: ({ user }) => queryClient.setQueryData(CURRENT_USER_KEY, user),
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password, fullName, timezone }: { email: string; password: string; fullName: string; timezone?: string }) =>
      authApi.register(email, password, fullName, timezone),
    onSuccess: ({ user }) => queryClient.setQueryData(CURRENT_USER_KEY, user),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { fullName?: string; timezone?: string }) => authApi.updateProfile(input),
    onSuccess: ({ user }) => queryClient.setQueryData(CURRENT_USER_KEY, user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => queryClient.setQueryData(CURRENT_USER_KEY, null),
  });
}
