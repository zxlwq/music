import { handleGdstudioFetch } from '../../adapters/gdstudio/handler.js';

export const onRequestGet = async ({ request }) => handleGdstudioFetch(request);

export const onRequestOptions = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
    },
  });
