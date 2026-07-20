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

    saveConfig() {
        try {
            const data = this.devices.map(d => {
                const { estado, source, ...rest } = d;
                return rest;
            });
            fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
            console.log('💾 [TuyaManager] Configuración guardada en tuya-devices.json');
        } catch (err) {
            console.error('❌ [TuyaManager] Error guardando configuración:', err.message);
        }
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
                    if (!devConfig.ip) {
                        await device.find({ timeout: 10 });
                    }
                    await device.connect();
                } catch (err) {
                    console.warn(`⚠️ [TuyaManager TCP] Error conectando a ${name}: ${err.message}. Reintentando en 15s...`);
                    // Si la IP estática falló, intentar descubrimiento UDP para detectar cambio de IP
                    if (devConfig.ip) {
                        try {
                            console.log(`🔍 [TuyaManager TCP] Intentando descubrir ${name} por UDP...`);
                            await device.find({ timeout: 15 });
                            if (device.device && device.device.ip && device.device.ip !== devConfig.ip) {
                                console.log(`✅ [TuyaManager TCP] ${name} encontrado en nueva IP: ${device.device.ip}`);
                                devConfig.ip = device.device.ip;
                                this.saveConfig();
                            }
                        } catch (findErr) {
                            console.warn(`⚠️ [TuyaManager TCP] No se pudo descubrir ${name} por UDP: ${findErr.message}`);
                        }
                    }
                    setTimeout(connectDevice, 15000);
                }
            };

            device.on('connected', () => {
                console.log(`✅ [TuyaManager TCP] Conectado a ${name} (${device.device.ip})`);
                if (device.device.ip && device.device.ip !== devConfig.ip) {
                    devConfig.ip = device.device.ip;
                    this.saveConfig();
                }
            });

            device.on('disconnected', () => {
                console.log(`❌ [TuyaManager TCP] Desconectado de ${name}. Reintentando en 10s...`);
                setTimeout(connectDevice, 10000);
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
                                if (dev.estado !== stateStr) {
                                    dev.estado = stateStr;
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
                    online: d.estado !== 'UNKNOWN',
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
            if (!devConfig.ip) {
                await device.find({ timeout: 10 });
            }
            await device.connect();
            await device.set({ dps: dps, set: value });
            await device.disconnect();

            devConfig.estado = state.toUpperCase();
            console.log(`✅ [TuyaManager Fallback] ${name} cambiado a ${state}`);
            return { status: 'ok', state };
        } catch (err) {
            // Si falló con IP estática, intentar descubrimiento UDP
            if (devConfig.ip) {
                try {
                    console.log(`🔍 [TuyaManager Fallback] Intentando descubrir ${name} por UDP...`);
                    const finder = new TuyAPI({
                        id: devConfig.id,
                        key: devConfig.key,
                        version: devConfig.version || '3.4'
                    });
                    await finder.find({ timeout: 15 });
                    if (finder.device && finder.device.ip) {
                        console.log(`✅ [TuyaManager Fallback] ${name} encontrado en IP: ${finder.device.ip}`);
                        devConfig.ip = finder.device.ip;
                        this.saveConfig();
                        await finder.connect();
                        await finder.set({ dps: dps, set: value });
                        await finder.disconnect();
                        devConfig.estado = state.toUpperCase();
                        console.log(`✅ [TuyaManager Fallback] ${name} cambiado a ${state} tras descubrimiento`);
                        return { status: 'ok', state };
                    }
                    await finder.disconnect().catch(() => {});
                } catch (findErr) {
                    console.error(`❌ [TuyaManager Fallback] Error en descubrimiento UDP para ${name}:`, findErr.message);
                }
            }
            console.error(`❌ [TuyaManager Fallback] Error controlando dispositivo ${name}:`, err.message);
            try {
                await device.disconnect();
            } catch (e) { }
            return { status: 'error', error: err.message };
        }
    }
}

const manager = new TuyaManager();
export default manager;

