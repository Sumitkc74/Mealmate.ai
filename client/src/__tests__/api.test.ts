import { describe, it, expect, beforeEach } from 'vitest';
import type { AxiosAdapter } from 'axios';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

const testUser: User = {
  id: 'u1',
  name: 'Interceptor Test',
  email: 'interceptor@example.com',
  role: 'user',
  pantry: [],
  dietaryPreferences: [],
  allergies: [],
};

// An adapter that rejects with a 401 shaped like an AxiosError, so the
// response interceptor runs without any real HTTP.
function unauthorizedAdapter(url: string, method: string): AxiosAdapter {
  return async () => {
    throw {
      response: { status: 401, data: { message: 'Unauthorized' } },
      config: { url, method },
      message: 'Request failed with status code 401',
    };
  };
}

describe('api 401 interceptor', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: testUser, authedAt: null });
  });

  it('logs out on a 401 from the session check (GET /auth/me)', async () => {
    await expect(
      api.get('/auth/me', { adapter: unauthorizedAdapter('/auth/me', 'get') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does not log out on a 401 from the session check within the post-auth grace window', async () => {
    // A login/register just proved the session valid (the server set the
    // cookie and returned the user), so a 401 from the immediate post-auth
    // /me validation is transient (cookie/proxy timing, cold Render) —
    // it must not destroy the session that was just established.
    useAuthStore.getState().setAuth({ user: testUser });
    await expect(
      api.get('/auth/me', { adapter: unauthorizedAdapter('/auth/me', 'get') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toEqual(testUser);
  });

  it('logs out on a 401 from the session check after the post-auth grace window', async () => {
    useAuthStore.setState({ user: testUser, authedAt: Date.now() - 30_000 });
    await expect(
      api.get('/auth/me', { adapter: unauthorizedAdapter('/auth/me', 'get') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does not log out on a 401 from a non-auth call', async () => {
    await expect(
      api.post('/recipes', { title: 'x' }, { adapter: unauthorizedAdapter('/recipes', 'post') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toEqual(testUser);
  });

  it('does not log out on a 401 from PATCH /auth/me (profile update)', async () => {
    await expect(
      api.patch('/auth/me', { pantry: [] }, { adapter: unauthorizedAdapter('/auth/me', 'patch') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toEqual(testUser);
  });

  it('does not log out when there is no signed-in user', async () => {
    useAuthStore.setState({ user: null });
    await expect(
      api.get('/auth/me', { adapter: unauthorizedAdapter('/auth/me', 'get') })
    ).rejects.toBeDefined();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
