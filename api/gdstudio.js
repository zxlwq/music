import { handleGdstudioRequest } from '../adapters/gdstudio/handler.js';

export default async function handler(req, res) {
  return handleGdstudioRequest(req, res);
}
