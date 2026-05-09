import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authAPI } from '../services/api';
import { toast } from '../components/common/Toast';

export function useUserPreferences() {
  return useQuery({
    queryKey: ['user-preferences'],
    queryFn: () => authAPI.getPreferences().then((r) => r.data.data),
    staleTime: 60_000,
  });
}

export function useUpdateUserPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => authAPI.updatePreferences(data).then((r) => r.data.data),
    onSuccess: (data) => {
      queryClient.setQueryData(['user-preferences'], data);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Failed to update guidance preferences');
    },
  });
}
