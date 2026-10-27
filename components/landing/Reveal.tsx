'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// A section that rises into place the first time it scrolls into view. With
// no JavaScript, or reduced motion, it is simply there.
export function Reveal({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.add('reveal-wait');
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('reveal-in'); io.disconnect(); }
    }, { threshold: 0.18 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`}>{children}</Tag>;
}
