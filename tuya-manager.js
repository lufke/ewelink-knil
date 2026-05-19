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
        // Retornamos todos excepto los ejemplos
        return this.devices.filter(d => !d.id.startsWith('ejemplo_'));
    }

    async setPowerState(deviceId, state) {
        const devConfig = this.devices.find(d => d.id === deviceId);
        if (!devConfig) {
            return { status: 'error', error: 'Dispositivo no encontrado en la configuración' };
        }

        console.log(`🔌 [TuyaManager] setPowerState local para ${devConfig.nombre} (${deviceId}) -> ${state}`);

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
            
            // Enviamos el comando de encendido/apagado al DPS 1 por defecto (el más común para switches y enchufes)
            await device.set({ set: value });
            
            await device.disconnect();

            // Actualizar el estado local
            devConfig.estado = state.toUpperCase();
            console.log(`✅ [TuyaManager] ${devConfig.nombre} cambiado exitosamente a ${state}`);
            return { status: 'ok', state };
        } catch (err) {
            console.error(`❌ [TuyaManager] Error controlando dispositivo ${devConfig.nombre}:`, err.message);
            try {
                await device.disconnect();
            } catch (e) {}
            return { status: 'error', error: err.message };
        }
    }
}

const manager = new TuyaManager();
export default manager;
