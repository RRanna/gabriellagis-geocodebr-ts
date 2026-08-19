import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { geocode } from 'geocodebr-ts';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'geocode-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === '/api/geocode' && req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', async () => {
              try {
                const { addresses } = JSON.parse(body);
                const results = await geocode(addresses, { strategy: 'lazy' });
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(results));
              } catch (e: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else {
            next();
          }
        });
      },
    },
  ],
});
