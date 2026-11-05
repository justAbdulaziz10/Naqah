import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ create: vi.fn(), signOut: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createWritableClient: mock.create }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
import { logout } from './actions';

describe('logout action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.create.mockResolvedValue({ auth: { signOut: mock.signOut } });
    mock.signOut.mockResolvedValue({ error: null });
    mock.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });
  it('clears the current session and redirects to localized login', async () => {
    await expect(logout('ar')).rejects.toThrow('NEXT_REDIRECT');
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mock.redirect).toHaveBeenCalledWith('/ar/login');
  });
  it('does not claim logout success on failure', async () => {
    mock.signOut.mockResolvedValue({ error: { status: 500 } });
    expect(await logout('en')).toEqual({ failed: true });
    expect(mock.redirect).not.toHaveBeenCalled();
  });
  it('handles unavailable configuration', async () => {
    mock.create.mockResolvedValue(null);
    expect(await logout('ar')).toEqual({ failed: true });
  });
  it('does not use untrusted locale values for redirects', async () => {
    expect(await logout('//evil.test')).toEqual({ failed: true });
    expect(mock.create).not.toHaveBeenCalled();
  });
});
