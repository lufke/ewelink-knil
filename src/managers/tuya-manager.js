import TuyAPI from 'tuyapi';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import dgram from 'dgram';
import crypto from 'crypto';
import messageParserPkg from 'tuyapi/lib/message-parser.js';
const { MessageParser } = messageParserPkg;

const UDP_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn', 'utf8').digest();

class TuyaManager extends EventEmitter {
    constructor() {
        super();
        this.configPath = path.resolve('tuya-devices.json');
        this.devices = [];
        this.connections = new Map(); // deviceId -> TuyAPI instance
        this.connectHandlers = new Map();
        this.reconnectTimers = new Map();
        this.loadDevices();
        this.startTcpConnections();
    }

    loadDevices() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                this.devices = JSON.parse(data).map(d => ({
                    ...d,
                    estado: 'UNKNOWN', // Estado inicial
                    online: false,
                    source: 'tuya'
                }));
                console.log(`🔌 [TuyaManager] Cargados ${this.devices.length} dispositivos desde tuya-devices.json`);
            } else {
                console.warn('⚠️ [TuyaManager] Archivo tuya-devices.json no encontrado. Creando uno vacío.');
                fs.writeFileSync(this.configPath, JSON.stringify([]));
                this.devices = [];
            }
        } catch (err) {
            console.error('❌ [TuyaManager] Error cargando tuya-devices.json:', err.message);
            this.devices = [];
        }
    }

    saveDevices() {
        try {
            const cleanDevices = this.devices.map(({ estado, online, source, ...config }) => config);
            fs.writeFileSync(this.configPath, JSON.stringify(cleanDevices, null, 2) + '\n');
            console.log('💾 [TuyaManager] tuya-devices.json actualizado con IPs descubiertas.');
        } catch (err) {
            console.error('❌ [TuyaManager] Error guardando tuya-devices.json:', err.message);
        }
    }

    updateDeviceIp(deviceId, ip) {
        if (!ip) return false;

        let changed = false;
        this.devices.forEach(dev => {
            if (dev.id !== deviceId) return;
            if (dev.ip !== ip) {
                dev.ip = ip;
                changed = true;
            }
        });

        if (changed) {
            this.saveDevices();
        }

        return changed;
    }

    scheduleReconnect(deviceId, connectDevice, delayMs) {
        if (this.reconnectTimers.has(deviceId)) return;

        const timer = setTimeout(() => {
            this.reconnectTimers.delete(deviceId);
            connectDevice();
        }, delayMs);

        if (timer.unref) timer.unref();
        this.reconnectTimers.set(deviceId, timer);
    }
    startTcpConnections() {
        // Agrupar dispositivos por su ID físico único
        const uniqueDevices = [];
        this.devices.forEach(d => {
            if (!uniqueDevices.some(ud => ud.id === d.id)) {
                uniqueDevices.push(d);
            }
        });

        uniqueDevices.forEach(devConfig => {
            const name = devConfig.nombre || devConfig.name || devConfig.id;
            console.log(`🔌 [TuyaManager] Iniciando conexión TCP persistente con ${name} (${devConfig.ip || 'Buscando por UDP...'})`);

            const device = new TuyAPI({
                id: devConfig.id,
                key: devConfig.key,
                ip: devConfig.ip || undefined,
                version: devConfig.version || '3.4',
                issueGetOnConnect: true
            });

            const connectDevice = async () => {
                try {
                    if (device.isConnected()) return;

                    await device.connect();
                } catch (err) {
                    console.warn(`⚠️ [TuyaManager TCP] Error conectando a ${name} (${devConfig.ip || 'sin IP'}): ${err.message}. Intentando redescubrir...`);

                    try {
                        await device.find({ timeout: 10 });
                        const discoveredIp = device.device?.ip;
                        if (discoveredIp) {
                            console.log(`🔎 [TuyaManager TCP] ${name} redescubierto en ${discoveredIp}`);
                            devConfig.ip = discoveredIp;
                            this.updateDeviceIp(devConfig.id, discoveredIp);
                        }

                        await device.connect();
                    } catch (discoverErr) {
                        this.setPhysicalDeviceOnline(devConfig.id, false);
                        console.warn(`⚠️ [TuyaManager TCP] No se pudo redescubrir/conectar ${name}: ${discoverErr.message}. Reintentando en 15s...`);
                        this.scheduleReconnect(devConfig.id, connectDevice, 15000);
                    }
                }
            };
            this.connectHandlers.set(devConfig.id, connectDevice);

            device.on('connected', () => {
                console.log(`✅ [TuyaManager TCP] Conectado a ${name} (${device.device.ip})`);
                devConfig.ip = device.device.ip;
                this.updateDeviceIp(devConfig.id, device.device.ip);
                this.setPhysicalDeviceOnline(devConfig.id, true, device.device.ip);
            });

            device.on('disconnected', () => {
                console.log(`❌ [TuyaManager TCP] Desconectado de ${name}. Reintentando en 10s...`);
                this.setPhysicalDeviceOnline(devConfig.id, false);
                this.scheduleReconnect(devConfig.id, connectDevice, 10000);
            });

            device.on('error', (err) => {
                // Evitar crashes por fallos de socket
                console.warn(`⚠️ [TuyaManager TCP] Error en dispositivo ${name}:`, err.message);
            });

            const handleData = (data) => {
                if (data && data.dps) {
                    // Buscar todos los canales asociados a este dispositivo físico
                    this.devices.forEach(dev => {
                        if (dev.id === devConfig.id) {
                            const channelDps = dev.dps || 1;
                            const newStateVal = data.dps[channelDps];
                            if (newStateVal !== undefined) {
                                const stateStr = newStateVal ? 'ON' : 'OFF';
                                const previousState = dev.estado;
                                dev.estado = stateStr;

                                if (previousState !== 'UNKNOWN' && previousState !== stateStr) {
                                    console.log(`🔌 [TuyaManager TCP] Detectado cambio físico en ${dev.nombre || dev.id} (DPS ${channelDps}): ${stateStr}`);
                                    const botId = `${dev.id}_${channelDps}`;
                                    this.emit('stateChange', {
                                        botId,
                                        deviceId: dev.id,
                                        dps: channelDps,
                                        state: stateStr.toLowerCase()
                                    });
                                }
                            }
                        }
                    });
                }
            };

            device.on('data', handleData);
            device.on('dp-refresh', handleData);

            // Iniciar la conexión asíncronamente
            connectDevice();

            // Guardar la conexión persistente
            this.connections.set(devConfig.id, device);
        });
    }

    async refreshDiscovery() {
        const uniqueDevices = [];
        this.devices.forEach(d => {
            if (!uniqueDevices.some(ud => ud.id === d.id)) {
                uniqueDevices.push(d);
            }
        });

        const results = [];
        for (const devConfig of uniqueDevices) {
            const name = devConfig.nombre || devConfig.name || devConfig.id;
            const persistentDevice = this.connections.get(devConfig.id);

            try {
                if (persistentDevice?.isConnected()) {
                    this.setPhysicalDeviceOnline(devConfig.id, true, persistentDevice.device?.ip);
                    results.push({ id: devConfig.id, name, status: 'online', ip: persistentDevice.device?.ip || devConfig.ip || null });
                    continue;
                }

                const device = persistentDevice || new TuyAPI({
                    id: devConfig.id,
                    key: devConfig.key,
                    ip: devConfig.ip || undefined,
                    version: devConfig.version || '3.4',
                    issueGetOnConnect: false
                });

                await device.find({ timeout: 10 });
                const discoveredIp = device.device?.ip;
                if (discoveredIp) {
                    devConfig.ip = discoveredIp;
                    this.updateDeviceIp(devConfig.id, discoveredIp);
                }

                const connectDevice = this.connectHandlers.get(devConfig.id);
                if (connectDevice) connectDevice();

                this.setPhysicalDeviceOnline(devConfig.id, true, discoveredIp || devConfig.ip);
                results.push({ id: devConfig.id, name, status: 'online', ip: discoveredIp || devConfig.ip || null });
            } catch (err) {
                this.setPhysicalDeviceOnline(devConfig.id, false);
                results.push({ id: devConfig.id, name, status: 'offline', error: err.message });
            }
        }

        const equipos = this.getEquipos();
        const online = equipos.filter(e => e.online).length;
        return {
            success: true,
            devices: equipos.length,
            online,
            offline: equipos.length - online,
            physicalDevices: uniqueDevices.length,
            results
        };
    }

    setPhysicalDeviceOnline(deviceId, online, ip = null) {
        this.devices.forEach(dev => {
            if (dev.id !== deviceId) return;

            const previous = dev.online;
            dev.online = online;
            if (ip) dev.ip = ip;

            if (previous !== online) {
                const botId = `${dev.id}_${dev.dps || 1}`;
                this.emit('availabilityChange', {
                    botId,
                    deviceId: dev.id,
                    dps: dev.dps || 1,
                    available: online ? 'online' : 'offline'
                });
            }
        });
    }

    getEquipos() {
        return this.devices
            .filter(d => !d.id.startsWith('ejemplo_'))
            .map(d => {
                const friendlyName = d.nombre || d.name || d.id;
                return {
                    id: `${d.id}_${d.dps || 1}`,
                    botId: `${d.id}_${d.dps || 1}`,
                    nombre: friendlyName,
                    name: friendlyName,
                    source: 'tuya',
                    dps: d.dps || 1,
                    ip: d.ip || 'N/A',
                    mac: d.mac || 'N/A',
                    modelo: d.modelo || d.model || 'Tuya Switch',
                    online: Boolean(d.online),
                    estado: d.estado ? d.estado.toLowerCase() : 'unknown'
                };
            });
    }

    async setPowerState(botId, state) {
        const parts = botId.split('_');
        const deviceId = parts[0];
        const dps = parts[1] ? parseInt(parts[1], 10) : 1;

        const devConfig = this.devices.find(d => d.id === deviceId && (d.dps || 1) === dps);
        if (!devConfig) {
            return { status: 'error', error: 'Dispositivo no encontrado en la configuración' };
        }

        const name = devConfig.nombre || devConfig.name || devConfig.id;
        console.log(`🔌 [TuyaManager] setPowerState para ${name} (DPS ${dps}) -> ${state}`);

        const value = state.toLowerCase() === 'on';

        // 1. Intentar usar la conexión TCP persistente si está activa
        const persistentDevice = this.connections.get(deviceId);
        if (persistentDevice && persistentDevice.isConnected()) {
            try {
                await persistentDevice.set({ dps: dps, set: value });
                devConfig.estado = state.toUpperCase();
                console.log(`✅ [TuyaManager TCP] ${name} cambiado a ${state} (Socket persistente)`);
                return { status: 'ok', state };
            } catch (err) {
                console.error(`❌ [TuyaManager TCP] Falló control directo: ${err.message}. Intentando fallback temporal...`);
            }
        }

        // 2. Fallback: Conexión temporal
        const device = new TuyAPI({
            id: devConfig.id,
            key: devConfig.key,
            ip: devConfig.ip || undefined,
            version: devConfig.version || '3.4',
            issueGetOnConnect: false
        });

        try {
            try {
                await device.connect();
            } catch (connectErr) {
                console.warn(`⚠️ [TuyaManager Fallback] Falló IP conocida para ${name}: ${connectErr.message}. Redescubriendo...`);
                await device.find({ timeout: 10 });
                const discoveredIp = device.device?.ip;
                if (discoveredIp) {
                    devConfig.ip = discoveredIp;
                    this.updateDeviceIp(devConfig.id, discoveredIp);
                }
                await device.connect();
            }

            await device.set({ dps: dps, set: value });
            await device.disconnect();

            devConfig.estado = state.toUpperCase();
            this.setPhysicalDeviceOnline(devConfig.id, true, devConfig.ip);
            console.log(`✅ [TuyaManager Fallback] ${name} cambiado a ${state}`);
            return { status: 'ok', state };
        } catch (err) {
            console.error(`❌ [TuyaManager Fallback] Error controlando dispositivo ${name}:`, err.message);
            this.setPhysicalDeviceOnline(devConfig.id, false);
            try {
                await device.disconnect();
            } catch (e) { }
            return { status: 'error', error: err.message };
        }
    }
}

const manager = new TuyaManager();
export default manager;
