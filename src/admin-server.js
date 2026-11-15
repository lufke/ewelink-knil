import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin');
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(response, status, body) {
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
    });
    response.end(JSON.stringify(body));
}

async function readJson(request) {
    let body = '';
    for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('Solicitud demasiado grande.');
    }
    return body ? JSON.parse(body) : {};
}

export function startAdminServer(registry, options = {}) {
    const host = options.host || process.env.ADMIN_HOST || '127.0.0.1';
    const port = Number(options.port ?? process.env.ADMIN_PORT ?? 8765);

    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, `http://${host}`);
        try {
            if (request.method === 'GET' && url.pathname === '/api/devices') {
                return sendJson(response, 200, { devices: registry.list() });
            }
            if (request.method === 'GET' && url.pathname === '/api/discovery') {
                return sendJson(response, 200, { devices: registry.getDiscovered() });
            }
            if (request.method === 'POST' && url.pathname === '/api/discovery') {
                return sendJson(response, 200, { result: await registry.discover() });
            }
            if (request.method === 'POST' && url.pathname === '/api/refresh') {
                const { source = 'all' } = await readJson(request);
                return sendJson(response, 200, { results: await registry.refresh(source) });
            }
            if (request.method === 'POST' && url.pathname === '/api/devices') {
                const { source = 'cozylife', id, name } = await readJson(request);
                return sendJson(response, 201, { device: await registry.add(source, id, name) });
            }
            const controlMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/set$/);
            if (request.method === 'POST' && controlMatch) {
                const { source, state } = await readJson(request);
                return sendJson(response, 200, {
                    result: await registry.setPowerState(source, decodeURIComponent(controlMatch[1]), state)
                });
            }
            const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
            if (request.method === 'PATCH' && deviceMatch) {
                const { source = 'cozylife', name } = await readJson(request);
                return sendJson(response, 200, {
                    device: await registry.rename(source, decodeURIComponent(deviceMatch[1]), name)
                });
            }
            if (request.method === 'DELETE' && deviceMatch) {
                const source = url.searchParams.get('source') || 'cozylife';
                return sendJson(response, 200, {
                    result: await registry.remove(source, decodeURIComponent(deviceMatch[1]))
                });
            }
            if (request.method === 'GET' && url.pathname === '/') {
                response.writeHead(200, {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'no-store'
                });
                response.end(await readFile(path.join(PUBLIC_DIR, 'index.html')));
                return;
            }
            if (request.method === 'GET' && ['/app.js', '/style.css', '/favicon.svg'].includes(url.pathname)) {
                const contentType = url.pathname.endsWith('.js')
                    ? 'text/javascript; charset=utf-8'
                    : url.pathname.endsWith('.css')
                        ? 'text/css; charset=utf-8'
                        : 'image/svg+xml';
                response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
                response.end(await readFile(path.join(PUBLIC_DIR, url.pathname.slice(1))));
                return;
            }
            sendJson(response, 404, { error: 'Ruta no encontrada.' });
        } catch (error) {
            sendJson(response, 400, { error: error.message });
        }
    });

    server.listen(port, host, () => {
        const address = server.address();
        console.log(`🧭 Administración local disponible en http://${host}:${address.port}`);
    });
    server.on('error', error => {
        console.error(`❌ No se pudo iniciar la administración local en ${host}:${port}: ${error.message}`);
    });
    return server;
}
