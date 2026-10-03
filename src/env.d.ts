/// <reference types="astro/client" />

declare const __GF_BUILD__: string;

interface Window {
  gfBuildGuard?: boolean;
}
