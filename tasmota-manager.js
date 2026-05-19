import mqtt from 'mqtt';
import dotenv from 'dotenv';

dotenv.config();

class TasmotaManager {
    constructor() {
        this.devices = new Map(); // topic -> info
        this.client = null;
    }

    async init() {
        try {
            const broker = process.env.MQTT_BROKER || 'mqtt://localhost';
            console.log(`TasmotaManager: Conectando a ${broker}...`);
            this.client = mqtt.connect(broker);

            this.client.on('connect', () => {
                console.log('TasmotaManager: Conectado y escuchando mensajes para auto-descubrimiento...');

                // Nos suscribimos a patrones globales de Tasmota para descubrir equipos
                this.client.subscribe('tele/+/LWT');
                this.client.subscribe('stat/+/POWER');
                this.client.subscribe('tele/+/STATE');

                // Solicitar estado actual de los tasmotas
                this.requestRefresh();
            });

            this.client.on('message', (topic, message) => {
                this.handleDiscovery(topic, message.toString());
            });

            this.client.on('error', (err) => {
                console.error('TasmotaManager MQTT Error:', err.message);
            });

            return true;
        } catch (error) {
            console.error('Error inicializando TasmotaManager:', error);
            return false;
        }
    }

    handleDiscovery(topic, message) {
        const parts = topic.split('/');
        // El formato suele ser prefix/topic/command
        // Ej: tele/tasmota_auto/LWT o stat/tasmota_auto/POWER
        const deviceTopic = parts[1];

        if (!deviceTopic) return;

        if (!this.devices.has(deviceTopic)) {
            this.devices.set(deviceTopic, {
                id: deviceTopic,
                nombre: deviceTopic, // Inicialmente el nombre es el topic
                topic: deviceTopic,
                estado: 'UNKNOWN',
                online: false,
                lastSeen: new Date()
            });
            console.log(`Tasmota detectado dinámicamente: ${deviceTopic}`);
        }

        const device = this.devices.get(deviceTopic);
        device.lastSeen = new Date();

        if (topic.endsWith('LWT')) {
            device.online = (message.toLowerCase() === 'online');
        } else if (topic.endsWith('POWER')) {
            device.estado = message.toUpperCase(); // ON u OFF
            device.online = true; // Si envía POWER, está online
            console.log(`Tasmota [${deviceTopic}] Estado actualizado: ${device.estado}`);
        } else if (topic.endsWith('STATE')) {
            try {
                const data = JSON.parse(message);
                if (data.POWER) {
                    device.estado = data.POWER;
                    device.online = true; // Si envía STATE, está online
                }
            } catch (e) {
                // No es JSON o no tiene POWER
            }
        }
    }

    requestRefresh() {
        if (this.client) {
            console.log('TasmotaManager: Solicitando estado actual de los dispositivos...');
            this.client.publish('cmnd/tasmotas/POWER', '');
        }
    }

    getEquipos() {
        return Array.from(this.devices.values()).map(d => ({
            ...d,
            source: 'tasmota'
        }));
    }

    async setPowerState(deviceTopic, state) {
        console.log(`[TasmotaManager] setPowerState: ${deviceTopic} -> ${state}`);
        if (!this.client) {
            console.error('[TasmotaManager] Error: No conectado a MQTT');
            return { error: 'Not connected to MQTT' };
        }

        const cmdTopic = `cmnd/${deviceTopic}/POWER`;
        const cmdValue = state.toUpperCase(); // Tasmota usa ON/OFF

        return new Promise((resolve) => {
            console.log(`[TasmotaManager] Publicando en ${cmdTopic}: ${cmdValue}`);
            this.client.publish(cmdTopic, cmdValue, {}, (err) => {
                if (err) {
                    console.error(`[TasmotaManager] Error publicando en ${cmdTopic}:`, err);
                    resolve({ error: err.message });
                } else {
                    console.log(`[TasmotaManager] Publicado con éxito en ${cmdTopic}`);
                    resolve({ status: 'ok', topic: deviceTopic, state: cmdValue });
                }
            });
        });
    }
}

const manager = new TasmotaManager();
export default manager;
