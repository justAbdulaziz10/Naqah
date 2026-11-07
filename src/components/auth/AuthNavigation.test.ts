import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/i18n/messages';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', getOwner: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getOwner: state.getOwner }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => null }));
vi.mock('@/i18n/client', () => ({ useI18n: () => ({ locale: state.locale, m: getMessages(state.locale), href: (path: string) => `/${state.locale}${path}` }) }));
vi.mock('./LogoutButton', () => ({ LogoutButton: () => createElement('button', {}, getMessages(state.locale).auth.logout) }));
import { ValidatedNavigation } from './AuthNavigation';
import { AuthNavigationClient, type AuthNavigationStyle } from './AuthNavigationClient';

beforeEach(() => { state.getOwner.mockReset(); });
describe('navigation authentication (server identity and rendered controls, mocked Auth)', () => {
  it('passes only the validated user ID to the client', async () => {
    state.getOwner.mockResolvedValue({ user: { id: 'owner-a', email: 'private@example.test' }, unavailable: false });
    const view = await ValidatedNavigation({ appearance: 'desktop' });
    expect(view.props).toEqual({ initialOwnerId: 'owner-a', appearance: 'desktop' });
    expect(state.getOwner).toHaveBeenCalledOnce();
  });
  it.each([false, true])('does not infer a signed-in owner when the server has no user (unavailable=%s)', async (unavailable) => {
    state.getOwner.mockResolvedValue({ user: null, unavailable });
    const view = await ValidatedNavigation({ appearance: 'mobile' });
    expect(view.props.initialOwnerId).toBeNull();
  });
  for (const locale of ['ar', 'en'] as const) {
    for (const appearance of ['desktop', 'mobile', 'welcome'] as AuthNavigationStyle[]) {
      it(`${locale}/${appearance} shows login/signup only when signed out with existing return paths`, () => {
        state.locale = locale;
        const html = renderToStaticMarkup(createElement(AuthNavigationClient, { initialOwnerId: null, appearance }));
        expect(html).toContain(`/${locale}/login?next=%2F${locale}%2Fapp`);
        expect(html).toContain(`/${locale}/signup?next=%2F${locale}%2Fstart`);
        expect(html).toContain(getMessages(locale).auth.navSignup);
        expect(html).not.toContain('<button');
      });
      it(`${locale}/${appearance} replaces both links with existing logout`, () => {
        state.locale = locale;
        const html = renderToStaticMarkup(createElement(AuthNavigationClient, { initialOwnerId: 'owner-a', appearance }));
        expect(html).toContain(getMessages(locale).auth.logout);
        expect(html).not.toContain('/login');
        expect(html).not.toContain('/signup');
      });
    }
  }
});
