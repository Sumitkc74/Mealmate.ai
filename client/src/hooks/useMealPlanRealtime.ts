import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/authStore';

let socket: Socket | null = null;

function getSocket(): Socket | null {
  if (socket && socket.connected) return socket;
  if (socket) socket.disconnect();
  // Auth rides on the httpOnly cookie (withCredentials sends it); the server
  // reads the token from the cookie during the Socket.IO handshake.
  socket = io({
    path: '/api/realtime',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    reconnection: true,
  });
  return socket;
}

/**
 * Subscribe the current user to live updates for a meal plan. Whenever another
 * client edits the same plan, React-Query caches for that plan / week / groceries
 * are invalidated so the UI refreshes automatically.
 */
export function useMealPlanRealtime(mealPlanId: string | undefined): void {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!mealPlanId || !isAuthed) return;
    const s = getSocket();
    if (!s) return;

    const handleUpdate = () => {
      void queryClient.invalidateQueries({ queryKey: ['mealPlan', mealPlanId] });
      void queryClient.invalidateQueries({ queryKey: ['mealPlans'] });
      void queryClient.invalidateQueries({ queryKey: ['grocery', mealPlanId] });
      void queryClient.invalidateQueries({ queryKey: ['nutrition', mealPlanId] });
    };
    const handleDelete = () => {
      void queryClient.invalidateQueries({ queryKey: ['mealPlans'] });
    };

    s.emit('mealplan:join', mealPlanId);
    s.on('mealplan:updated', handleUpdate);
    s.on('mealplan:deleted', handleDelete);

    return () => {
      s.emit('mealplan:leave', mealPlanId);
      s.off('mealplan:updated', handleUpdate);
      s.off('mealplan:deleted', handleDelete);
    };
  }, [mealPlanId, isAuthed, queryClient]);
}
