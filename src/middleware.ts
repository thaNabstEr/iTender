import { defineMiddleware } from 'astro:middleware';
import { loadDesk, type Desk } from './lib/desk.ts';

// Loaded lazily, so a form action that runs first is reflected in the page it renders.
export const onRequest = defineMiddleware((context, next) => {
  let desk: Promise<Desk> | undefined;
  context.locals.desk = () => (desk ??= loadDesk());
  return next();
});
