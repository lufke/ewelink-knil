import ngrok from '@ngrok/ngrok';
import dotenv from 'dotenv';

dotenv.config();

class NgrokManager {
    constructor() {
        this.listener = null;
        this.PORT = 1883;
        this.PROTO = 'tcp';
        this.TOKEN = process.env.NGROK_AUTH_TOKEN;
        this.watchdogInterval = null;
    }

    async init() {
        if (!this.TOKEN) {
            console.error('[NgrokManager] ⚠️ NGROK_AUTH_TOKEN no definido en .env. El túnel no se iniciará.');
            return false;
        }

        try {
            await this.startTunnel();
            this.startWatchdog();
            
            // Cerrar el túnel de manera limpia cuando se detiene el proceso
            process.on('SIGTERM', () => this.stopTunnel());
            process.on('SIGINT', () => this.stopTunnel());
            
            return true;
        } catch (error) {
            console.error('[NgrokManager] ❌ Error crítico en init:', error);
            return false;
        }
    }

    async startTunnel() {
        try {
            console.log('🚀 [NgrokManager] Iniciando túnel ngrok...');

            const brokerUrl = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
            let addr = this.PORT;

            try {
                // Asegurarse de que tenga protocolo para que la clase URL lo parsee correctamente
                const urlString = brokerUrl.includes('://') ? brokerUrl : `mqtt://${brokerUrl}`;
                const parsed = new URL(urlString);
                if (parsed.host) {
                    addr = parsed.host;
                }
            } catch (err) {
                console.warn('[NgrokManager] ⚠️ Error parseando MQTT_BROKER, usando puerto 1883 por defecto:', err.message);
            }

            console.log(`🔌 [NgrokManager] Redirigiendo túnel ngrok a: ${addr}`);

            this.listener = await ngrok.forward({
                addr: addr,
                proto: this.PROTO,
                authtoken: this.TOKEN,
            });

            console.log(`✅ [NgrokManager] MQTT expuesto exitosamente en: ${this.listener.url()}`);
        } catch (err) {
            console.error('❌ [NgrokManager] Error iniciando túnel:', err.message);
            this.restartLater();
        }
    }

    async stopTunnel() {
        try {
            if (this.listener) {
                await this.listener.close();
                this.listener = null;
                console.log('🛑 [NgrokManager] Túnel ngrok cerrado.');
            }
        } catch (e) {
            console.error('[NgrokManager] Error cerrando túnel:', e.message);
        }
    }

    restartLater(delay = 5000) {
        console.log(`🔄 [NgrokManager] Reintentando en ${delay / 1000}s...`);
        setTimeout(async () => {
            await this.stopTunnel();
            await this.startTunnel();
        }, delay);
    }

    startWatchdog() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        
        this.watchdogInterval = setInterval(async () => {
            try {
                if (!this.listener) throw new Error('Listener null');
                // ping interno
                await this.listener.url();
            } catch (err) {
                console.warn('⚠️ [NgrokManager] Túnel caído, reiniciando...');
                this.restartLater();
            }
        }, 30_000);
    }

    getUrl() {
        return this.listener ? this.listener.url() : null;
    }
}

const manager = new NgrokManager();
export default manager;
