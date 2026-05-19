import eWelink from "@pipechela/ewelink-api";
import Zeroconf from '@pipechela/ewelink-api/src/classes/Zeroconf.js';
import { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } from "./conifg.js";
import fs from 'fs/promises';
import os from 'os';

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

class EwelinkManager {
    constructor() {
        this.devicesCache = [];
        this.arpTable = [];
        this.connection = null;
        this.cloudConnection = null;
        this.isAuthenticated = false;
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

            // Cargar ARP (IPs locales)
            try {
                const arpData = await fs.readFile('./arp-table.json', 'utf8');
                this.arpTable = JSON.parse(arpData);
                console.log(`[EwelinkManager] Tabla ARP cargada (${this.arpTable.length} entradas).`);
            } catch (e) {
                this.arpTable = [];
            }

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
            console.log('[EwelinkManager] Autenticando en eWelink Cloud...');
            try {
                await this.cloudConnection.getCredentials();
                this.isAuthenticated = true;
                console.log('[EwelinkManager] ✅ Autenticado en Cloud (Fallback listo).');
            } catch (e) {
                console.error('[EwelinkManager] ❌ Error autenticando en Cloud:', e.message);
            }

            // Intentar un refresh de ARP en segundo plano para actualizar IPs
            console.log('[EwelinkManager] Iniciando escaneo ARP en segundo plano...');
            Zeroconf.getArpTable(getLocalIp()).then(table => {
                this.arpTable = table;
                this.connection.arpTable = table;
                console.log(`[EwelinkManager] 🔄 Tabla ARP actualizada dinámicamente: ${table.length} dispositivos encontrados.`);
                // Guardar para la próxima vez
                fs.writeFile('./arp-table.json', JSON.stringify(table, null, 2)).catch(() => { });
            }).catch(e => {
                console.warn('[EwelinkManager] ⚠️ Falló escaneo ARP dinámico:', e.message);
            });

            return true;
        } catch (error) {
            console.error('[EwelinkManager] Error crítico en init:', error);
            return false;
        }
    }

    async refreshCache() {
        console.log('[EwelinkManager] Forzando actualización total...');
        try {
            if (!this.isAuthenticated) {
                await this.cloudConnection.getCredentials();
                this.isAuthenticated = true;
            }

            await this.cloudConnection.saveDevicesCache();
            const table = await Zeroconf.getArpTable(getLocalIp());
            this.arpTable = table;
            await fs.writeFile('./arp-table.json', JSON.stringify(table, null, 2));

            const cacheData = await fs.readFile('./devices-cache.json', 'utf8');
            this.devicesCache = JSON.parse(cacheData);

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

    getEquipos() {
        return this.devicesCache.map(item => ({
            nombre: item.name,
            id: item.deviceid,
            mac: item.extra?.extra?.staMac || 'N/A',
            ip: this.getIP(item) || 'N/A',
            modelo: item.extra?.extra?.model || 'N/A',
            online: item.online,
            estado: item.params?.switch || item.params?.switches?.[0]?.switch || 'unknown'
        }));
    }

    getIP(device) {
        const mac = (device.extra?.extra?.staMac || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
        if (!mac) return null;
        const found = this.arpTable.find(i => i.mac.replace(/[^a-fA-F0-9]/g, '').toLowerCase() === mac);
        return found ? found.ip : null;
    }

    async setPowerState(deviceId, state) {
        const equipo = this.devicesCache.find(d => d.deviceid === deviceId);
        const ip = equipo ? this.getIP(equipo) : 'IP Desconocida';

        console.log(`[EwelinkManager] Comando: ${equipo?.name || deviceId} -> ${state} (IP: ${ip})`);

        // 1. Intentar LAN
        try {
            if (ip === 'IP Desconocida') throw new Error('Dispositivo no encontrado en red local');

            const result = await this.connection.setDevicePowerState(deviceId, state);
            console.log(`[EwelinkManager] ✅ Control LAN exitoso para ${deviceId}`);
            return result;
        } catch (lanError) {
            console.warn(`[EwelinkManager] ⚠️ LAN fallo (${lanError.message}). Intentando Cloud...`);

            if (this.isAuthenticated) {
                try {
                    const res = await this.cloudConnection.setDevicePowerState(deviceId, state);
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
}

const manager = new EwelinkManager();
export default manager;
