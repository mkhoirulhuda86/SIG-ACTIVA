'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    // Check authentication status
    const checkAuth = async () => {
      const localAuth = localStorage.getItem('isAuthenticated') === 'true';
      let serverAuth = false;

      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        serverAuth = res.ok;
      } catch {
        serverAuth = false;
      }

      const auth = localAuth && serverAuth;
      if (localAuth && !serverAuth) {
        localStorage.removeItem('isAuthenticated');
      }

      setIsAuthenticated(auth);
      setIsChecking(false);

      // If not authenticated and not on login or register page, redirect immediately
      if (!auth && pathname !== '/login' && pathname !== '/register') {
        router.replace('/login');
      }
    };

    checkAuth();

    // Listen for storage changes (when login happens in another tab or component)
    const handleStorageChange = () => {
      checkAuth();
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [pathname, router]);

  // Show nothing while checking authentication
  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render protected content if not authenticated
  if (!isAuthenticated && pathname !== '/login' && pathname !== '/register') {
    return null;
  }

  return <>{children}</>;
}
