/// <reference types="vite/client" />

declare global {
  interface Window {
    toggleFavorites?: () => void;
    switchToR2?: () => void;
    switchToWebDAV?: () => void;
    webkitAudioContext?: typeof AudioContext;
  }

  interface HTMLAudioElement {
    /** 缓存池 LRU */
    lastUsed?: number;
  }
}

declare module 'react' {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}

export {};
