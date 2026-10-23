import React, { useEffect, useRef } from 'react';
import type { LoaderConfig } from '@/lib/boot';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- shared CommonJS module, also used by scripts/postexport.js
const shell = require('@/lib/loaderShell.js') as { CSS: string; render(box: HTMLElement, cfg: Partial<LoaderConfig>): void };

/** Inject the loader keyframes once (the production shell already ships them in index.html). */
function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('dwira-boot-css')) return;
  const style = document.createElement('style');
  style.id = 'dwira-boot-css';
  style.textContent = shell.CSS;
  document.head.appendChild(style);
}

/** Web: exactly the markup visitors see in index.html, so the admin preview is faithful. */
export function BootLoader({ config, scale = 1 }: { config: Pick<LoaderConfig, 'style' | 'color' | 'uri' | 'anim'>; scale?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { ensureCss(); if (box.current) shell.render(box.current, config); }, [config.style, config.color, config.uri, config.anim]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.createElement('div', { ref: box, className: 'db-box', style: scale === 1 ? undefined : { transform: `scale(${scale})` } });
}
