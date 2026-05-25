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
                console.log('TasmotaManager: Conectado. Suscribiendo a discovery y telemetría...');

                // Tópico de discovery nativo de Tasmota (publicado al arrancar con retain=true)
                // Payload JSON con: t (topic), fn (friendly names), dn (device name),
                // ip, mac, md (model), sw (firmware), hn (hostname)
                this.client.subscribe('tasmota/discovery/+/config');

                // Tópicos de telemetría para estado en tiempo real
                this.client.subscribe('tele/+/LWT');
                this.client.subscribe('stat/+/POWER');
                this.client.subscribe('tele/+/STATE');

                // Solicitar estado actual de todos los Tasmota en la red
                this.requestRefresh();
            });

            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message.toString());
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

    handleMessage(topic, message) {
        // --- 1. Discovery nativo de Tasmota: tasmota/discovery/<mac>/config ---
        if (topic.startsWith('tasmota/discovery/') && topic.endsWith('/config')) {
            this.handleNativeDiscovery(message);
            return;
        }

        // --- 2. Telemetría en tiempo real: tele/+/LWT, stat/+/POWER, tele/+/STATE ---
        const parts = topic.split('/');
        const deviceTopic = parts[1];
        if (!deviceTopic) return;

        this.ensureDevice(deviceTopic);
        const device = this.devices.get(deviceTopic);
        device.lastSeen = new Date();

        if (topic.endsWith('/LWT')) {
            device.online = (message.toLowerCase() === 'online');
            console.log(`[TasmotaManager] LWT [${deviceTopic}]: ${message}`);

        } else if (topic.endsWith('/POWER')) {
            device.estado = message.toUpperCase();
            device.online = true;
            console.log(`[TasmotaManager] POWER [${deviceTopic}]: ${device.estado}`);

        } else if (topic.endsWith('/STATE')) {
            try {
                const data = JSON.parse(message);
                if (data.POWER) {
                    device.estado = data.POWER;
                    device.online = true;
                }
            } catch (e) {
                // No es JSON válido
            }
        }
    }

    /**
     * Procesa el payload JSON del tópico tasmota/discovery/<mac>/config.
     * Campos relevantes del payload:
     *   t   → MQTT topic (base topic del dispositivo)
     *   fn  → Array de friendly names (fn[0] es el nombre principal)
     *   dn  → Device name
     *   ip  → IP address
     *   mac → MAC address
     *   md  → Model
     *   sw  → Firmware version
     *   hn  → Hostname
     */
    handleNativeDiscovery(message) {
        try {
            const data = JSON.parse(message);
            const topic = data.t;
            if (!topic) return;

            this.ensureDevice(topic);
            const device = this.devices.get(topic);

            // Nombre: usar primer friendly name si existe, si no el device name
            const friendlyName = Array.isArray(data.fn) ? data.fn[0] : null;
            device.nombre   = friendlyName || data.dn || topic;
            device.ip       = data.ip  || device.ip;
            device.mac      = data.mac || device.mac;
            device.modelo   = data.md  || device.modelo;
            device.firmware = data.sw  || device.firmware;
            device.hostname = data.hn  || device.hostname;
            device.lastSeen = new Date();

            console.log(`[TasmotaManager] 🔍 Discovery [${topic}]: "${device.nombre}" (${device.ip || '?'}) modelo=${device.modelo || '?'} fw=${device.firmware || '?'}`);
        } catch (e) {
            console.warn('[TasmotaManager] Error parseando discovery payload:', e.message);
        }
    }

    /**
     * Asegura que el dispositivo existe en el mapa con valores por defecto.
     */
    ensureDevice(topic) {
        if (!this.devices.has(topic)) {
            this.devices.set(topic, {
                id: topic,
                nombre: topic,
                topic,
                estado: 'UNKNOWN',
                online: false,
                ip: null,
                mac: null,
                modelo: null,
                firmware: null,
                hostname: null,
                lastSeen: new Date()
            });
            console.log(`[TasmotaManager] Nuevo dispositivo detectado: ${topic}`);
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
