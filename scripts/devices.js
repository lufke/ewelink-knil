import dotenv from 'dotenv';
import { setTimeout as delay } from 'node:timers/promises';

dotenv.config();

const host = process.env.ADMIN_HOST || '127.0.0.1';
const port = process.env.ADMIN_PORT || 8765;
const baseUrl = `http://${host}:${port}`;
const [command = 'list', ...args] = process.argv.slice(2);

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...options
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

try {
    if (command === 'list') {
        const { devices } = await request('/api/devices');
        if (!devices.length) console.log('No hay dispositivos registrados.');
        else console.table(devices.map(({ id, nombre, source, estado, online, ip }) =>
            ({ id, nombre, fabricante: source, estado, disponible: online, ip })));
    } else if (command === 'discover') {
        await request('/api/discovery', { method: 'POST', body: '{}' });
        const waitMs = Math.max(0, Math.min(Number(args[0] || 2500), 15000));
        await delay(waitMs);
        const { devices } = await request('/api/discovery');
        if (!devices.length) console.log('No se detectaron dispositivos CozyLife.');
        else console.table(devices.map(({ id, ip, mac, pid, rssi, configured }) =>
            ({ id, ip, mac, pid, rssi, registrado: configured })));
    } else if (command === 'add') {
        const [source, id, ...nameParts] = args;
        if (!source || !id) throw new Error('Uso: npm run devices -- add cozylife <id> [nombre]');
        console.log(JSON.stringify(await request('/api/devices', {
            method: 'POST',
            body: JSON.stringify({ source, id, name: nameParts.join(' ') || undefined })
        }), null, 2));
    } else if (command === 'remove') {
        const [source, id] = args;
        if (!source || !id) throw new Error('Uso: npm run devices -- remove cozylife <id>');
        console.log(JSON.stringify(await request(
            `/api/devices/${encodeURIComponent(id)}?source=${encodeURIComponent(source)}`,
            { method: 'DELETE' }
        ), null, 2));
    } else if (command === 'rename') {
        const [source, id, ...nameParts] = args;
        const name = nameParts.join(' ').trim();
        if (!source || !id || !name) throw new Error('Uso: npm run devices -- rename cozylife <id> <nuevo nombre>');
        console.log(JSON.stringify(await request(`/api/devices/${encodeURIComponent(id)}`, {
            method: 'PATCH', body: JSON.stringify({ source, name })
        }), null, 2));
    } else if (command === 'refresh') {
        console.log(JSON.stringify(await request('/api/refresh', {
            method: 'POST', body: JSON.stringify({ source: args[0] || 'all' })
        }), null, 2));
    } else if (command === 'on' || command === 'off') {
        const [source, id] = args;
        if (!source || !id) throw new Error(`Uso: npm run devices -- ${command} <fabricante> <id>`);
        console.log(JSON.stringify(await request(`/api/devices/${encodeURIComponent(id)}/set`, {
            method: 'POST',
            body: JSON.stringify({ source, state: command })
        }), null, 2));
    } else {
        throw new Error('Uso: npm run devices -- [list|discover [espera_ms]|add cozylife <id> [nombre]|rename cozylife <id> <nuevo nombre>|remove cozylife <id>|refresh [fabricante]|on|off <fabricante> <id>]');
    }
} catch (error) {
    console.error(`Administración no disponible en ${baseUrl}: ${error.message}`);
    process.exitCode = 1;
}
