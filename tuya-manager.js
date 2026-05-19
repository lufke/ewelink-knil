import TuyAPI from 'tuyapi';
import fs from 'fs';
import path from 'path';

class TuyaManager {
    constructor() {
        this.configPath = path.resolve('tuya-devices.json');
        this.devices = [];
        this.loadDevices();
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

    getEquipos() {
        // Retornamos todos excepto los ejemplos y agregamos un botId único para Telegram
        return this.devices
            .filter(d => !d.id.startsWith('ejemplo_'))
            .map(d => ({
                ...d,
                botId: `${d.id}_${d.dps || 1}`
            }));
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
        console.log(`🔌 [TuyaManager] setPowerState local para ${name} (DPS ${dps}) -> ${state}`);

        const device = new TuyAPI({
            id: devConfig.id,
            key: devConfig.key,
            ip: devConfig.ip || undefined, // si está definida la IP acelera la conexión
            issueGetOnConnect: false
        });

        try {
            // Buscar en red local (tiempo de espera de 3 segundos)
            await device.find({ timeout: 3 });
            await device.connect();

            const value = state.toLowerCase() === 'on';
            
            // Enviamos el comando de encendido/apagado al DPS correspondiente (por ejemplo: 1, 2, 3...)
            await device.set({ dps: dps, set: value });
            
            await device.disconnect();

            // Actualizar el estado local
            devConfig.estado = state.toUpperCase();
            console.log(`✅ [TuyaManager] ${name} cambiado exitosamente a ${state}`);
            return { status: 'ok', state };
        } catch (err) {
            console.error(`❌ [TuyaManager] Error controlando dispositivo ${name}:`, err.message);
            try {
                await device.disconnect();
            } catch (e) {}
            return { status: 'error', error: err.message };
        }
    }
}

const manager = new TuyaManager();
export default manager;
