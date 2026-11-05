import { Suspense } from 'react';
import { OwnerAuth } from '@/components/auth/OwnerAuth';

export default function SignupPage() {
  return <Suspense fallback={null}><OwnerAuth mode="signup" /></Suspense>;
}
