'use client';

import { createContext, useContext } from 'react';
import type { AuthMethodsAvailable } from '@/lib/supabase/auth-methods';

/** The sign-in methods Supabase Auth has switched on, read on the server for this page. */
export const AuthOptions = createContext<AuthMethodsAvailable | null>(null);

export const useAuthOptions = () => useContext(AuthOptions);

/** The form to show: what was asked for if it is on, else mobile when SMS works, else email. */
export function chooseMethod(requested: string | null, methods: AuthMethodsAvailable): 'phone' | 'email' {
  if (requested === 'email' && methods.email) return 'email';
  if (requested === 'phone' && methods.phone) return 'phone';
  return methods.phone ? 'phone' : 'email';
}
