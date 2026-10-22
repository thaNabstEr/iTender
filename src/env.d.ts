/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** The desk for this request, loaded once and shared by the page and the layout. */
    desk: () => Promise<import('./lib/desk.ts').Desk>;
  }
}

interface Window {
  toast: (message: string) => void;
}
