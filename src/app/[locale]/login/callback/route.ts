import type { NextRequest } from 'next/server';
import { completeAuthCallback } from '@/lib/supabase/callback';

export async function GET(request: NextRequest, context: { params: Promise<{ locale: string }> }) {
  return completeAuthCallback(request, (await context.params).locale);
}
