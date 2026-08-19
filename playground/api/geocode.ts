import type { VercelRequest, VercelResponse } from '@vercel/node';
import { geocode } from 'geocodebr-ts';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Configuração de CORS para permitir requisições de outros domínios (Gabriella GIS)
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST') {
    try {
      const { addresses } = req.body || {};

      if (!addresses || !Array.isArray(addresses)) {
        res.status(400).json({ error: 'Payload inválido. "addresses" deve ser um array.' });
        return;
      }

      if (addresses.length > 1000) {
        res.status(413).json({
          error: 'Limite excedido. Por favor, envie no máximo 1000 endereços por requisição.',
        });
        return;
      }

      const results = await geocode(addresses, { strategy: 'lazy' });
      res.status(200).json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  } else {
    res.setHeader('Allow', 'POST');
    res.status(405).end('Method Not Allowed');
  }
}
