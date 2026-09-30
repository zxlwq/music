import { handleGdstudioFetch } from '../../adapters/gdstudio/handler.js';

export function onRequest(context) {
  return handleGdstudioFetch(context.request);
}
