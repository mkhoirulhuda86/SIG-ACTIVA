'use client';

import { useEffect } from 'react';
import AOS from 'aos';
import { usePathname } from 'next/navigation';
import 'aos/dist/aos.css';

export default function AosProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    AOS.init({
      duration: 500,
      easing: 'ease-out-cubic',
      once: true,
      offset: 48,
    });
  }, []);

  useEffect(() => {
    AOS.refreshHard();
  }, [pathname]);

  return <>{children}</>;
}
