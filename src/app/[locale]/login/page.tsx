import { Suspense } from 'react';
import { OwnerAuth } from '@/components/auth/OwnerAuth';

export default function LoginPage() {
  return <Suspense fallback={null}><OwnerAuth mode="login" /></Suspense>;
}
