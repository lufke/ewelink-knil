import eWelink from "@pipechela/ewelink-api";
import Zeroconf from '@pipechela/ewelink-api/src/classes/Zeroconf.js';
import { decryptionData } from '@pipechela/ewelink-api/src/helpers/ewelink.js';
import bonjourService from 'bonjour-service';
const { Bonjour } = bonjourService;
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
dotenv.config();

const { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } = process.env;
import fs from 'fs/promises';
import os from 'os';

const EWELINK_ARP_REFRESH_INTERVAL_MS = Number(process.env.EWELINK_ARP_REFRESH_INTERVAL_MS || 60000);
const EWELINK_CLOUD_ENABLED = process.env.EWELINK_CLOUD_ENABLED !== 'false';
const EWELINK_CLOUD_TIMEOUT_MS = Number(process.env.EWELINK_CLOUD_TIMEOUT_MS || 7000);

function withTimeout(promise, timeoutMs, label) {
    let timeout;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} excedió ${timeoutMs}ms`)), timeoutMs);
        if (timeout.unref) timeout.unref();
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return null;
}

class EwelinkManager extends EventEmitter {
    constructor() {
        super();
        this.devicesCache = [];
        this.arpTable = [];
        this.connection = null;
        this.cloudConnection = null;
        this.isAuthenticated = false;
        this.onlineByDeviceId = new Map();
        this.arpRefreshTimer = null;
    }

    async init() {
        try {
            console.log('[EwelinkManager] Cargando datos locales...');

            // Cargar Cache
            try {
                const cacheData = await fs.readFile('./devices-cache.json', 'utf8');
                this.devicesCache = JSON.parse(cacheData);
                console.log(`[EwelinkManager] Cache cargado: ${this.devicesCache.length} equipos.`);
            } catch (e) {
                console.warn('[EwelinkManager] No se pudo cargar devices-cache.json');
                this.devicesCache = [];
            }

            // Cargar ARP (IPs locales) desde disco como fallback
            try {
                const arpData = await fs.readFile('./arp-table.json', 'utf8');
                this.arpTable = JSON.parse(arpData);
                console.log(`[EwelinkManager] Tabla ARP cargada (${this.arpTable.length} entradas).`);
            } catch (e) {
                this.arpTable = [];
            }

            await this.reloadArpTable();
            this.refreshOnlineStatus();

            // Inicializar conexiones
            this.connection = new eWelink({
                devicesCache: this.devicesCache,
                arpTable: this.arpTable
            });

            this.cloudConnection = new eWelink({
                email: EWELINK_EMAIL,
                password: EWELINK_PASSWORD,
                APP_ID: APP_ID,
                APP_SECRET: APP_SECRET
            });

            // Autenticar Cloud para tener Fallback listo
            if (EWELINK_CLOUD_ENABLED) {
                console.log(`[EwelinkManager] Autenticando en eWelink Cloud (timeout ${EWELINK_CLOUD_TIMEOUT_MS}ms)...`);
                try {
                    await withTimeout(this.cloudConnection.getCredentials(), EWELINK_CLOUD_TIMEOUT_MS, 'Autenticación eWelink Cloud');
                    this.isAuthenticated = true;
                    console.log('[EwelinkManager] ✅ Autenticado en Cloud (Fallback listo).');
                } catch (e) {
                    console.warn('[EwelinkManager] ⚠️ Cloud no disponible; continuando solo con LAN:', e.message);
                }
            } else {
                console.log('[EwelinkManager] Cloud desactivado por EWELINK_CLOUD_ENABLED=false. Modo LAN solamente.');
            }

            // Iniciar escaneo mDNS local para detectar pulsaciones de botones físicos
            this.startMdnsListener();
            this.startAvailabilityMonitor();

            return true;
        } catch (error) {
            console.error('[EwelinkManager] Error crítico en init:', error);
            return false;
        }
    }

    async refreshCache() {
        console.log('[EwelinkManager] Forzando actualización total...');
        try {
            if (!EWELINK_CLOUD_ENABLED) {
                return { success: false, error: 'Cloud desactivado por EWELINK_CLOUD_ENABLED=false' };
            }

            if (!this.isAuthenticated) {
                await withTimeout(this.cloudConnection.getCredentials(), EWELINK_CLOUD_TIMEOUT_MS, 'Autenticación eWelink Cloud');
                this.isAuthenticated = true;
            }

            await this.cloudConnection.saveDevicesCache();
            await this.reloadArpTable();

            const cacheData = await fs.readFile('./devices-cache.json', 'utf8');
            this.devicesCache = JSON.parse(cacheData);
            this.refreshOnlineStatus();

            this.connection = new eWelink({
                devicesCache: this.devicesCache,
                arpTable: this.arpTable
            });

            return { success: true, count: this.devicesCache.length };
        } catch (error) {
            console.error('[EwelinkManager] Error en refreshCache:', error);
            return { success: false, error: error.message };
        }
    }

    async reloadArpTable() {
        try {
            console.log('[EwelinkManager] Recargando tabla ARP local...');
            const table = await Zeroconf.getArpTable(getLocalIp());
            this.arpTable = table;
            if (this.connection) this.connection.arpTable = table;
            await fs.writeFile('./arp-table.json', JSON.stringify(table, null, 2));
            console.log(`[EwelinkManager] 🔄 Tabla ARP actualizada: ${table.length} dispositivos encontrados.`);
            return table;
        } catch (e) {
            console.warn(`[EwelinkManager] ⚠️ Falló recarga ARP; usando tabla guardada (${this.arpTable.length} entradas): ${e.message}`);
            return this.arpTable;
        }
    }

    isDeviceOnline(device) {
        return Boolean(this.getIP(device));
    }

    refreshOnlineStatus() {
        this.devicesCache.forEach(device => {
            this.onlineByDeviceId.set(device.deviceid, this.isDeviceOnline(device));
        });
    }

    publishOnlineStatusFromArp() {
        this.devicesCache.forEach(device => {
            this.setOnlineStatus(device.deviceid, this.isDeviceOnline(device));
        });
    }

    async refreshArpAvailability() {
        await this.reloadArpTable();
        this.publishOnlineStatusFromArp();

        const equipos = this.getEquipos();
        const online = equipos.filter(e => e.online).length;
        return {
            success: true,
            arpEntries: this.arpTable.length,
            devices: equipos.length,
            online,
            offline: equipos.length - online
        };
    }

    startAvailabilityMonitor() {
        if (this.arpRefreshTimer || EWELINK_ARP_REFRESH_INTERVAL_MS <= 0) return;

        this.arpRefreshTimer = setInterval(async () => {
            await this.reloadArpTable();
            this.publishOnlineStatusFromArp();
        }, EWELINK_ARP_REFRESH_INTERVAL_MS);

        if (this.arpRefreshTimer.unref) this.arpRefreshTimer.unref();
    }

    setOnlineStatus(deviceId, online) {
        const previous = this.onlineByDeviceId.get(deviceId);
        this.onlineByDeviceId.set(deviceId, online);
        if (previous !== online) {
            this.emit('availabilityChange', {
                deviceId,
                available: online ? 'online' : 'offline'
            });
        }
    }

    getEquipos() {
        return this.devicesCache.map(item => {
            const friendlyName = item.name || 'N/A';
            return {
                id: item.deviceid,
                nombre: friendlyName,
                name: friendlyName,
                source: 'ewelink',
                mac: item.extra?.extra?.staMac || 'N/A',
                ip: this.getIP(item) || 'N/A',
                modelo: item.extra?.extra?.model || 'N/A',
                online: this.onlineByDeviceId.get(item.deviceid) ?? this.isDeviceOnline(item),
                estado: item.params?.switch || item.params?.switches?.[0]?.switch || 'unknown'
            };
        });
    }

    getIP(device) {
        const mac = (device.extra?.extra?.staMac || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
        if (!mac) return null;
        const found = this.arpTable.find(i => i.mac.replace(/[^a-fA-F0-9]/g, '').toLowerCase() === mac);
        return found ? found.ip : null;
    }

    async setPowerState(deviceId, state) {
        const equipo = this.devicesCache.find(d => d.deviceid === deviceId);
        let ip = equipo ? this.getIP(equipo) : null;

        if (equipo && !ip) {
            await this.reloadArpTable();
            ip = this.getIP(equipo);
            this.publishOnlineStatusFromArp();
        }

        console.log(`[EwelinkManager] Comando: ${equipo?.name || deviceId} -> ${state} (IP: ${ip || 'IP Desconocida'})`);

        // 1. Intentar LAN
        try {
            if (!ip) throw new Error('Dispositivo no encontrado en red local');

            const result = await this.connection.setDevicePowerState(deviceId, state);
            console.log(`[EwelinkManager] ✅ Control LAN exitoso para ${deviceId}`);
            return result;
        } catch (lanError) {
            console.warn(`[EwelinkManager] ⚠️ LAN fallo (${lanError.message}). Intentando Cloud...`);

            if (this.isAuthenticated) {
                try {
                    const res = await withTimeout(
                        this.cloudConnection.setDevicePowerState(deviceId, state),
                        EWELINK_CLOUD_TIMEOUT_MS,
                        'Control eWelink Cloud'
                    );
                    console.log(`[EwelinkManager] ✅ Control CLOUD exitoso para ${deviceId}`);
                    return res;
                } catch (cloudErr) {
                    console.error(`[EwelinkManager] ❌ Ambos fallaron: ${cloudErr.message}`);
                    throw cloudErr;
                }
            } else {
                throw lanError;
            }
        }
    }

    startMdnsListener() {
        try {
            const bonjour = new Bonjour();
            const browser = bonjour.find({ type: 'ewelink', protocol: 'tcp' });

            const handleService = (service) => {
                const deviceId = service.txt?.id || service.name?.split('_')?.[1];
                if (!deviceId) return;

                const cacheDevice = this.devicesCache.find(d => d.deviceid === deviceId);
                if (!cacheDevice) return;
                this.setOnlineStatus(deviceId, true);

                const deviceKey = cacheDevice.devicekey;
                if (!deviceKey) return;

                const txt = service.txt;
                if (!txt) return;

                // Concatenar los bloques data1, data2, data3, data4
                const encryptedData = (txt.data1 || '') + (txt.data2 || '') + (txt.data3 || '') + (txt.data4 || '');
                const iv = txt.iv;
                if (!encryptedData || !iv) return;

                try {
                    const decryptedRaw = decryptionData(encryptedData, deviceKey, iv);
                    if (!decryptedRaw) return;

                    const payload = JSON.parse(decryptedRaw);

                    let switchState = null;
                    if (payload.switch) {
                        switchState = payload.switch.toLowerCase(); // 'on' / 'off'
                    } else if (payload.switches && Array.isArray(payload.switches)) {
                        switchState = payload.switches[0].switch.toLowerCase();
                    }

                    if (switchState) {
                        const currentState = (cacheDevice.params?.switch || cacheDevice.params?.switches?.[0]?.switch || '').toLowerCase();
                        if (currentState === switchState) return;

                        // Actualizar estado en la caché en memoria
                        if (cacheDevice.params) {
                            if (cacheDevice.params.switch) cacheDevice.params.switch = switchState;
                            if (cacheDevice.params.switches && cacheDevice.params.switches[0]) {
                                cacheDevice.params.switches[0].switch = switchState;
                            }
                        }

                        console.log(`📡 [EwelinkManager] mDNS Detectado cambio físico en [${cacheDevice.name || deviceId}]: ${switchState}`);

                        this.emit('stateChange', {
                            deviceId,
                            state: switchState
                        });
                    }
                } catch (err) {
                    // Ignorar errores de desencriptación (ej. claves no coincidentes)
                }
            };

            browser.on('up', handleService);
            browser.on('txt-update', handleService);
            browser.on('down', (service) => {
                const deviceId = service.txt?.id || service.name?.split('_')?.[1];
                if (deviceId) this.setOnlineStatus(deviceId, false);
            });

            console.log('📡 [EwelinkManager] Escáner mDNS iniciado (escuchando cambios físicos locales eWelink)');
        } catch (error) {
            console.error('[EwelinkManager] Error iniciando escáner mDNS:', error.message);
        }
    }
}

const manager = new EwelinkManager();
export default manager;
