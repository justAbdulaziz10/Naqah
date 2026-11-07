import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/i18n/messages';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar', getOwner: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getOwner: state.getOwner }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => null }));
vi.mock('@/i18n/client', () => ({ useI18n: () => ({ locale: state.locale, m: getMessages(state.locale), href: (path: string) => `/${state.locale}${path}` }) }));
vi.mock('./LogoutButton', () => ({ LogoutButton: () => createElement('button', {}, getMessages(state.locale).auth.logout) }));
import { AuthNavigation, ValidatedNavigation } from './AuthNavigation';
import { AuthNavigationClient, AuthNavigationLoading, type AuthNavigationStyle } from './AuthNavigationClient';

beforeEach(() => { state.getOwner.mockReset(); });
describe('navigation authentication (server identity and rendered controls, mocked Auth)', () => {
  it('uses the accessible placeholder for the unresolved server stream too', () => {
    const boundary = AuthNavigation({ appearance: 'mobile' });
    expect(boundary.props.fallback.type).toBe(AuthNavigationLoading);
    expect(boundary.props.fallback.props.appearance).toBe('mobile');
  });
  it('passes only the validated user ID to the client', async () => {
    state.getOwner.mockResolvedValue({ user: { id: 'owner-a', email: 'private@example.test' }, unavailable: false });
    const view = await ValidatedNavigation({ appearance: 'desktop' });
    expect(view.props).toEqual({ initialIdentity: { status: 'signedIn', ownerId: 'owner-a' }, appearance: 'desktop' });
    expect(state.getOwner).toHaveBeenCalledOnce();
  });
  it.each([false, true])('does not infer a signed-in owner when the server has no user (unavailable=%s)', async (unavailable) => {
    state.getOwner.mockResolvedValue({ user: null, unavailable });
    const view = await ValidatedNavigation({ appearance: 'mobile' });
    expect(view.props.initialIdentity).toEqual({ status: unavailable ? 'unknown' : 'signedOut' });
  });
  for (const locale of ['ar', 'en'] as const) {
    for (const appearance of ['desktop', 'mobile'] as AuthNavigationStyle[]) {
      it(`${locale}/${appearance} keeps failed validation unresolved with an accessible stable placeholder`, () => {
        state.locale = locale;
        const html = renderToStaticMarkup(createElement(AuthNavigationClient, { initialIdentity: { status: 'unknown' }, appearance }));
        const fallback = renderToStaticMarkup(createElement(AuthNavigationLoading, { appearance }));
        expect(html).toBe(fallback);
        expect(html).toContain('role="status"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain(`aria-label="${getMessages(locale).auth.loading}"`);
        expect(html).toContain('min-h-11');
        expect(html).not.toContain('/login');
        expect(html).not.toContain('/signup');
      });
      it(`${locale}/${appearance} shows login/signup only when signed out with existing return paths`, () => {
        state.locale = locale;
        const html = renderToStaticMarkup(createElement(AuthNavigationClient, { initialIdentity: { status: 'signedOut' }, appearance }));
        expect(html).toContain(`/${locale}/login?next=%2F${locale}%2Fapp`);
        expect(html).toContain(`/${locale}/signup?next=%2F${locale}%2Fstart`);
        expect(html).toContain(getMessages(locale).auth.navSignup);
        expect(html).toContain('>' + getMessages(locale).landing.nav.signIn + '</a>');
        expect(html).not.toContain('<button');
      });
      it(`${locale}/${appearance} replaces both links with existing logout`, () => {
        state.locale = locale;
        const html = renderToStaticMarkup(createElement(AuthNavigationClient, { initialIdentity: { status: 'signedIn', ownerId: 'owner-a' }, appearance }));
        expect(html).toContain(getMessages(locale).auth.logout);
        expect(html).not.toContain('/login');
        expect(html).not.toContain('/signup');
      });
    }
  }
});
