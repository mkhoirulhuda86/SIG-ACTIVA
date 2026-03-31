'use client';

import { useEffect, useRef } from 'react';
import Typed from 'typed.js';

type TypedTextProps = {
  text: string;
  className?: string;
  typeSpeed?: number;
  startDelay?: number;
  showCursor?: boolean;
};

export default function TypedText({
  text,
  className,
  typeSpeed = 34,
  startDelay = 120,
  showCursor = false,
}: TypedTextProps) {
  const elRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const typed = new Typed(elRef.current, {
      strings: [text],
      typeSpeed,
      startDelay,
      showCursor,
      smartBackspace: false,
      contentType: 'html',
    });

    return () => typed.destroy();
  }, [text, typeSpeed, startDelay, showCursor]);

  return <span className={className} ref={elRef} />;
}
