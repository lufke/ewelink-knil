import 'dotenv/config';
import dgram from 'node:dgram';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const UDP_PORT = 6095;
const TCP_PORT = 5555;
const DISCOVERY_INTERVAL_MS = Number(process.env.COZYLIFE_DISCOVERY_INTERVAL_MS || 60000);
const STATE_POLL_INTERVAL_MS = Number(process.env.COZYLIFE_STATE_POLL_INTERVAL_MS || 30000);
const RECONNECT_DELAY_MS = 10000;

let sequence = Date.now();
function nextSequence() {
    sequence = Math.max(Date.now(), sequence + 1);
    return String(sequence);
}

function encodeTcpFrame(cmd, msg) {
    return Buffer.from(JSON.stringify({ pv: 0, cmd, sn: nextSequence(), msg }) + '\r\n');
}

function normalizeState(value) {
    if (value === 1 || value === true || value === '1' || String(value).toLowerCase() === 'on') return 'on';
    if (value === 0 || value === false || value === '0' || String(value).toLowerCase() === 'off') return 'off';
    return 'unknown';
}

export class CozyLifeManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.configPath = options.configPath || path.resolve('cozylife-devices.json');
        this.devices = new Map();
        this.discovered = new Map();
        this.discoverySocket = null;
        this.discoveryTimer = null;
        this.loadDevices();
    }

    loadDevices() {
        try {
            if (!fs.existsSync(this.configPath)) return;
            const configs = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            if (!Array.isArray(configs)) throw new Error('Se esperaba una lista de dispositivos.');
            for (const config of configs) {
                if (config?.id && config?.ip) this.devices.set(config.id, this.createDevice(config));
            }
        } catch (error) {
            console.error('[CozyLifeManager] Error cargando cozylife-devices.json:', error.message);
        }
    }

    saveDevices() {
        const configs = [...this.devices.values()].map(({ socket, buffer, pollTimer, reconnectTimer, online, estado, ...config }) => config);
        const temporaryPath = `${this.configPath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(configs, null, 2) + '\n');
        fs.renameSync(temporaryPath, this.configPath);
    }

    createDevice(config) {
        return {
            id: config.id,
            nombre: config.nombre || config.name || config.id,
            name: config.nombre || config.name || config.id,
            source: 'cozylife',
            ip: config.ip,
            mac: config.mac || null,
            pid: config.pid || null,
            dtp: config.dtp || null,
            rssi: config.rssi ?? null,
            sv: config.sv || null,
            hv: config.hv || null,
            estado: 'unknown',
            online: false,
            socket: null,
            buffer: '',
            pollTimer: null,
            reconnectTimer: null
        };
    }

    async init() {
        try {
            await this.openDiscoverySocket();
            for (const device of this.devices.values()) this.connect(device);
            await this.refreshDiscovery();
            if (DISCOVERY_INTERVAL_MS > 0) {
                this.discoveryTimer = setInterval(() => this.refreshDiscovery(), DISCOVERY_INTERVAL_MS);
                this.discoveryTimer.unref?.();
            }
            return true;
        } catch (error) {
            console.error('[CozyLifeManager] Error iniciando el descubrimiento:', error.message);
            return false;
        }
    }

    openDiscoverySocket() {
        if (this.discoverySocket) return Promise.resolve();
        const socket = dgram.createSocket('udp4');
        this.discoverySocket = socket;
        socket.on('message', (packet, remote) => this.handleDiscovery(packet, remote));
        socket.on('error', error => console.error('[CozyLifeManager UDP] Error:', error.message));
        return new Promise((resolve, reject) => {
            socket.once('error', reject);
            socket.bind(0, '0.0.0.0', () => {
                socket.removeListener('error', reject);
                socket.setBroadcast(true);
                resolve();
            });
        });
    }

    refreshDiscovery() {
        if (!this.discoverySocket) return Promise.resolve({ success: false, error: 'Socket de descubrimiento no iniciado.' });
        return new Promise(resolve => {
            const frame = { pv: 0, cmd: 0, sn: nextSequence(), msg: {} };
            const packet = Buffer.from(JSON.stringify(frame) + '\r\n');
            this.discoverySocket.send(packet, UDP_PORT, '255.255.255.255', error => {
                if (error) {
                    console.warn('[CozyLifeManager UDP] No se pudo enviar el broadcast:', error.message);
                    resolve({ success: false, error: error.message });
                } else {
                    resolve({ success: true, devices: this.discovered.size });
                }
            });
        });
    }

    handleDiscovery(packet, remote) {
        try {
            const text = packet.toString('utf8').split('\r\n', 1)[0];
            const frame = JSON.parse(text);
            const info = frame?.msg;
            if (frame?.cmd !== 0 || frame?.res !== 0 || typeof info?.did !== 'string' || !info.did) return;
            const ip = typeof info.ip === 'string' ? info.ip : remote.address;
            const record = {
                id: info.did,
                ip,
                mac: info.mac || null,
                pid: info.pid || null,
                dtp: info.dtp || null,
                rssi: info.rssi ?? null,
                sv: info.sv || null,
                hv: info.hv || null,
                lastSeen: new Date().toISOString(),
                configured: this.devices.has(info.did)
            };
            this.discovered.set(record.id, record);
            const configured = this.devices.get(record.id);
            if (configured) {
                const addressChanged = configured.ip !== ip;
                Object.assign(configured, record, { nombre: configured.nombre, name: configured.name, estado: configured.estado, online: configured.online });
                if (addressChanged) {
                    this.disconnect(configured);
                    this.connect(configured);
                    this.saveDevices();
                }
                this.emit('deviceUpdated', this.toPublicDevice(configured));
                this.emit('deviceDiscovered', record);
                return;
            }
            this.emit('deviceDiscovered', record);
        } catch {
            // Otros datagramas de la red no pertenecen al protocolo CozyLife.
        }
    }

    getDiscovered() {
        return [...this.discovered.values()].map(device => ({ ...device }));
    }

    addDevice(id, name) {
        const discovered = this.discovered.get(id);
        if (!discovered) throw new Error(`No se encontró ${id} en el último descubrimiento CozyLife.`);
        if (this.devices.has(id)) throw new Error(`El dispositivo ${id} ya está registrado.`);
        const device = this.createDevice({
            ...discovered,
            nombre: name || id
        });
        this.devices.set(id, device);
        this.saveDevices();
        discovered.configured = true;
        this.connect(device);
        this.emit('deviceAdded', this.toPublicDevice(device));
        return this.toPublicDevice(device);
    }

    renameDevice(id, name) {
        const device = this.devices.get(id);
        const normalizedName = typeof name === 'string' ? name.trim() : '';
        if (!device) throw new Error(`El dispositivo CozyLife ${id} no está registrado.`);
        if (!normalizedName) throw new Error('El nombre del dispositivo no puede estar vacío.');
        device.nombre = normalizedName;
        device.name = normalizedName;
        this.saveDevices();
        const updated = this.toPublicDevice(device);
        this.emit('deviceUpdated', updated);
        return updated;
    }

    removeDevice(id) {
        const device = this.devices.get(id);
        if (!device) throw new Error(`El dispositivo CozyLife ${id} no está registrado.`);
        this.disconnect(device);
        this.devices.delete(id);
        this.saveDevices();
        const discovered = this.discovered.get(id);
        if (discovered) discovered.configured = false;
        this.emit('deviceRemoved', { id });
        return { success: true, id };
    }

    connect(device) {
        if (!device.ip || device.socket) return;
        const socket = net.createConnection({ host: device.ip, port: TCP_PORT });
        device.socket = socket;
        device.buffer = '';
        socket.setEncoding('utf8');
        socket.on('connect', () => {
            if (device.socket !== socket) return;
            this.setOnline(device, true);
            this.queryState(device);
            if (STATE_POLL_INTERVAL_MS > 0) {
                device.pollTimer = setInterval(() => this.queryState(device), STATE_POLL_INTERVAL_MS);
                device.pollTimer.unref?.();
            }
        });
        socket.on('data', chunk => this.handleTcpData(device, socket, chunk));
        socket.on('error', error => console.warn(`[CozyLifeManager TCP] ${device.nombre}: ${error.message}`));
        socket.on('close', () => {
            if (device.socket !== socket) return;
            device.socket = null;
            if (device.pollTimer) clearInterval(device.pollTimer);
            device.pollTimer = null;
            this.setOnline(device, false);
            device.reconnectTimer = setTimeout(() => {
                device.reconnectTimer = null;
                this.connect(device);
            }, RECONNECT_DELAY_MS);
            device.reconnectTimer.unref?.();
        });
    }

    handleTcpData(device, socket, chunk) {
        if (device.socket !== socket) return;
        device.buffer += chunk;
        const frames = device.buffer.split('\r\n');
        device.buffer = frames.pop() || '';
        for (const rawFrame of frames) {
            if (!rawFrame.trim()) continue;
            try {
                this.handleTcpFrame(device, JSON.parse(rawFrame));
            } catch (error) {
                console.warn(`[CozyLifeManager TCP] Trama inválida de ${device.id}:`, error.message);
            }
        }
    }

    handleTcpFrame(device, frame) {
        if (!frame || typeof frame !== 'object') return;
        const message = frame.msg;
        if (frame.res !== undefined && frame.res !== 0) {
            this.emit('protocolError', { deviceId: device.id, cmd: frame.cmd, response: frame.res });
            return;
        }
        if (!message || typeof message !== 'object') return;
        const values = message.data;
        if (!values || typeof values !== 'object' || !Object.hasOwn(values, '1')) return;
        const state = normalizeState(values['1']);
        if (state !== 'unknown') this.setState(device, state);
    }

    queryState(device) {
        if (!device.socket || device.socket.destroyed) return;
        device.socket.write(encodeTcpFrame(2, { attr: [1] }), error => {
            if (error) console.warn(`[CozyLifeManager] Error consultando ${device.nombre}:`, error.message);
        });
    }

    setPowerState(id, state) {
        const device = this.devices.get(id);
        if (!device) return Promise.resolve({ status: 'error', error: 'Dispositivo CozyLife no registrado.' });
        if (!device.socket || device.socket.destroyed) return Promise.resolve({ status: 'error', error: 'Dispositivo CozyLife desconectado.' });
        const value = state === 'on' ? 1 : 0;
        return new Promise(resolve => {
            const frame = encodeTcpFrame(3, { attr: [1], data: { '1': value } });
            device.socket.write(frame, error => {
                resolve(error
                    ? { status: 'error', error: error.message }
                    : { status: 'ok', id, state });
            });
        });
    }

    setState(device, state) {
        const changed = device.estado !== state;
        device.estado = state;
        this.setOnline(device, true);
        if (changed) this.emit('stateChange', { deviceId: device.id, state });
    }

    setOnline(device, online) {
        if (device.online === online) return;
        device.online = online;
        this.emit('availabilityChange', { deviceId: device.id, available: online ? 'online' : 'offline' });
    }

    toPublicDevice(device) {
        const { socket, buffer, pollTimer, reconnectTimer, ...visible } = device;
        return { ...visible };
    }

    getEquipos() {
        return [...this.devices.values()].map(device => this.toPublicDevice(device));
    }

    close() {
        if (this.discoveryTimer) clearInterval(this.discoveryTimer);
        this.discoveryTimer = null;
        this.discoverySocket?.close();
        this.discoverySocket = null;
        for (const device of this.devices.values()) this.disconnect(device);
    }

    disconnect(device) {
        if (device.pollTimer) clearInterval(device.pollTimer);
        if (device.reconnectTimer) clearTimeout(device.reconnectTimer);
        device.pollTimer = null;
        device.reconnectTimer = null;
        const socket = device.socket;
        device.socket = null;
        socket?.destroy();
        this.setOnline(device, false);
    }
}

const cozyLifeManager = new CozyLifeManager();
export default cozyLifeManager;
