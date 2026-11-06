// TEST ONLY. Explicit preload: NAQAH_AUTH_QA=mock-only node --import ./scripts/auth-qa-fixture.mjs ...
// Never use the preload in a deployed server. It replaces Auth-server validation with fixtures.
const ownerId = '11111111-1111-4111-8111-111111111111';
const signature = Buffer.from('mock-only-no-real-auth').toString('base64url');
export function fixtureUser() {
  return { id: ownerId, aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', phone: '966501234567',
    app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' };
}
export function fixtureSession(origin) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: ownerId, aud: 'authenticated', role: 'authenticated', iss: `${origin}/auth/v1`, iat: now, exp: now + 3600, mock_only: true })}.${signature}`;
  return { access_token: token, refresh_token: 'mock-only-refresh-token', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user: fixtureUser() };
}
function validFixtureAuthorization(request) {
  return request.headers.get('authorization')?.split('.')[2] === signature;
}
if (process.env.NAQAH_AUTH_QA === 'mock-only') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url.pathname.startsWith('/auth/v1/')) return realFetch(input, init);
    if (!target || url.origin !== new URL(target).origin) throw new Error('Mock-only fixture rejected an unexpected Auth origin');
    const request = new Request(input, init);
    const json = (body, status = 200) => Response.json(body, { status, headers: { 'x-supabase-api-version': '2024-01-01' } });
    if (url.pathname.endsWith('/user') && validFixtureAuthorization(request)) return json(fixtureUser());
    if (url.pathname.endsWith('/logout') && validFixtureAuthorization(request)) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/otp')) {
      const body = await request.json();
      if (/^\+9665\d{8}$/.test(body.phone) && body.create_user === true) return json({});
    }
    if (url.pathname.endsWith('/token')) {
      const body = await request.json();
      if (url.searchParams.get('grant_type') === 'pkce' && ['qa-google-code', 'qa-email-code'].includes(body.auth_code) && body.code_verifier?.length >= 43) return json(fixtureSession(url.origin));
      if (url.searchParams.get('grant_type') === 'refresh_token' && body.refresh_token === 'mock-only-refresh-token') return json(fixtureSession(url.origin));
    }
    return json({ code: 'invalid_credentials', msg: 'Mock-only request rejected' }, 401);
  };
}
