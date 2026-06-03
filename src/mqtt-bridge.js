import mqtt from 'mqtt';
import ewelinkManager from './managers/ewelink-manager.js';
import tuyaManager from './managers/tuya-manager.js';
import tasmotaManager from './managers/tasmota-manager.js';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost';
const MQTT_PREFIX = 'luces';
const BRIDGE_REFRESH_TOPIC = `${MQTT_PREFIX}/_bridge/refresh`;
const BRIDGE_REFRESH_STATUS_TOPIC = `${MQTT_PREFIX}/_bridge/refresh/status`;

async function startBridge() {
    console.log('--- Iniciando Puente IoT Totalmente Unificado a MQTT ---');

    // Inicializar el manager de eWelink (carga cache y tabla ARP)
    const ewelinkInitialized = await ewelinkManager.init();
    if (!ewelinkInitialized) {
        console.warn('⚠️ No se pudo inicializar el manager de eWelink. Verifica los archivos de cache.');
    }

    // Inicializar el manager de Tasmota (para el control y descubrimiento)
    const tasmotaInitialized = await tasmotaManager.init();
    if (!tasmotaInitialized) {
        console.warn('⚠️ No se pudo inicializar el manager de Tasmota.');
    }

    const client = mqtt.connect(MQTT_BROKER);

    // Escuchar cambios de estado físicos locales para eWelink
    ewelinkManager.on('stateChange', ({ deviceId, state }) => {
        client.publish(`${MQTT_PREFIX}/${deviceId}/state`, state, { retain: true });
        console.log(`[Puente Unificado] eWelink Local -> Publicado estado [${deviceId}]: ${state}`);
    });

    ewelinkManager.on('availabilityChange', ({ deviceId, available }) => {
        client.publish(`${MQTT_PREFIX}/${deviceId}/available`, available, { retain: true });
        console.log(`[Puente Unificado] eWelink Local -> Disponibilidad [${deviceId}]: ${available}`);
    });

    // Escuchar cambios de estado físicos locales para Tuya
    tuyaManager.on('stateChange', ({ botId, state }) => {
        client.publish(`${MQTT_PREFIX}/${botId}/state`, state, { retain: true });
        console.log(`[Puente Unificado] Tuya Local -> Publicado estado [${botId}]: ${state}`);
    });

    tuyaManager.on('availabilityChange', ({ botId, available }) => {
        client.publish(`${MQTT_PREFIX}/${botId}/available`, available, { retain: true });
        console.log(`[Puente Unificado] Tuya Local -> Disponibilidad [${botId}]: ${available}`);
    });

    client.on('connect', () => {
        console.log(`✅ Puente MQTT conectado al broker: ${MQTT_BROKER}`);

        // Suscribirse al tópico de control unificado: luces/+/set
        client.subscribe(`${MQTT_PREFIX}/+/set`, (err) => {
            if (!err) console.log(`📡 Suscrito a comandos unificados: ${MQTT_PREFIX}/+/set`);
        });

        client.subscribe(BRIDGE_REFRESH_TOPIC, (err) => {
            if (!err) console.log(`📡 Suscrito a refresco manual: ${BRIDGE_REFRESH_TOPIC}`);
        });

        // Traducir stat/+/POWER → luces/+/state
        client.subscribe('stat/+/POWER', (err) => {
            if (!err) console.log(`📡 Suscrito a estado Tasmota: stat/+/POWER`);
        });

        // Traducir tele/+/LWT → luces/+/available  (Online / Offline)
        client.subscribe('tele/+/LWT', (err) => {
            if (!err) console.log(`📡 Suscrito a disponibilidad Tasmota: tele/+/LWT`);
        });

        // Escuchar el discovery nativo de Tasmota para publicar config en luces/+/config
        client.subscribe('tasmota/discovery/+/config', (err) => {
            if (!err) console.log(`📡 Suscrito a discovery nativo de Tasmota: tasmota/discovery/+/config`);
        });

        // Publicar config y disponibilidad inicial. El estado se publica solo ante cambios físicos reales.
        publicarEstadoEwelink(client);
        publicarEstadoTuya(client);

        // Imprimir directorio unificado en consola
        imprimirDirectorioConsola();
    });

    client.on('message', async (topic, message) => {
        const payload = message.toString().toLowerCase();

        if (topic === BRIDGE_REFRESH_TOPIC) {
            await refrescarDesdeMqtt(client, payload);
            return;
        }

        // --- 1a. Discovery nativo de Tasmota (tasmota/discovery/<mac>/config) ---
        if (topic.startsWith('tasmota/discovery/') && topic.endsWith('/config')) {
            publicarConfigTasmota(client, message.toString());
            return;
        }

        // --- 1b. LWT de Tasmota (tele/+/LWT) → luces/+/available ---
        // Payload: "Online" u "Offline"
        if (topic.startsWith('tele/') && topic.endsWith('/LWT')) {
            const deviceTopic = topic.split('/')[1];
            if (deviceTopic) {
                const available = message.toString().toLowerCase() === 'online' ? 'online' : 'offline';
                client.publish(`${MQTT_PREFIX}/${deviceTopic}/available`, available, { retain: true });
                console.log(`[Tasmota Bridge] 📶 LWT [${deviceTopic}]: ${available}`);
            }
            return;
        }

        // --- 1c. Estado de Tasmota (stat/+/POWER) → luces/+/state ---
        if (topic.startsWith('stat/') && topic.endsWith('/POWER')) {
            const deviceTopic = topic.split('/')[1];
            if (deviceTopic) {
                client.publish(`${MQTT_PREFIX}/${deviceTopic}/state`, payload, { retain: true });
                console.log(`[Tasmota Bridge] 🔄 POWER [${deviceTopic}]: ${payload}`);
            }
            return;
        }

        // --- 2. Caso: Comandos unificados (luces/<id>/set) ---
        const parts = topic.split('/');
        if (parts.length !== 3 || parts[0] !== MQTT_PREFIX || parts[2] !== 'set') return;

        const deviceId = parts[1];

        if (payload !== 'on' && payload !== 'off') {
            console.warn(`⚠️ Estado inválido recibido en ${topic}: ${payload}. Solo se permite 'on' u 'off'.`);
            return;
        }

        console.log(`[Puente Unificado] MQTT -> Recibido comando '${payload}' para dispositivo '${deviceId}'`);

        // RUTA A: TUYA
        const esTuya = tuyaManager.getEquipos().some(e => e.botId === deviceId);
        if (esTuya) {
            try {
                const response = await tuyaManager.setPowerState(deviceId, payload);
                if (response.status === 'ok') {
                    console.log(`[Puente Unificado] OK -> Tuya [${deviceId}] cambiado a ${payload}`);
                } else {
                    console.error(`[Puente Unificado] Error Tuya [${deviceId}]:`, response);
                }
            } catch (error) {
                console.error(`[Puente Unificado] Error controlando Tuya [${deviceId}]:`, error.message);
            }
            return;
        }

        // RUTA A: EWELINK
        const esEwelink = ewelinkManager.getEquipos().some(e => e.id === deviceId);
        if (esEwelink) {
            try {
                const response = await ewelinkManager.setPowerState(deviceId, payload);
                if (response.status === 'ok' || response.state === payload) {
                    console.log(`[Puente Unificado] OK -> eWelink [${deviceId}] cambiado a ${payload}`);
                } else {
                    console.error(`[Puente Unificado] Error eWelink [${deviceId}]:`, response);
                }
            } catch (error) {
                console.error(`[Puente Unificado] Error controlando eWelink [${deviceId}]:`, error.message);
            }
            return;
        }

        // RUTA A: TASMOTA (Se asume por descarte)
        try {
            const response = await tasmotaManager.setPowerState(deviceId, payload);
            if (response.status === 'ok') {
                console.log(`[Puente Unificado] OK -> Comando enviado a Tasmota [${deviceId}]`);
                // El estado se reflejará de vuelta automáticamente mediante el listener de stat/+/POWER
            } else {
                console.error(`[Puente Unificado] Error Tasmota [${deviceId}]:`, response);
            }
        } catch (error) {
            console.error(`[Puente Unificado] Error controlando Tasmota [${deviceId}]:`, error.message);
        }
    });

    client.on('error', (err) => {
        console.error('❌ Error en cliente MQTT del puente:', err);
    });
}

async function refrescarDesdeMqtt(client, payload) {
    const command = payload.trim() || 'arp';
    if (!['arp', 'ewelink', 'tuya', 'all'].includes(command)) {
        client.publish(BRIDGE_REFRESH_STATUS_TOPIC, JSON.stringify({
            status: 'error',
            command,
            error: "Comando invalido. Usa 'arp', 'ewelink', 'tuya' o 'all'.",
            ts: new Date().toISOString()
        }));
        console.warn(`[Puente Unificado] Refresco manual inválido: ${command}`);
        return;
    }

    try {
        console.log(`[Puente Unificado] Refresco manual solicitado: ${command}`);
        const response = {
            status: 'ok',
            command,
            ts: new Date().toISOString()
        };

        if (command === 'arp' || command === 'ewelink' || command === 'all') {
            response.ewelink = await ewelinkManager.refreshArpAvailability();
            publicarEstadoEwelink(client);
        }

        if (command === 'tuya' || command === 'all') {
            response.tuya = await tuyaManager.refreshDiscovery();
            publicarEstadoTuya(client);
        }

        client.publish(BRIDGE_REFRESH_STATUS_TOPIC, JSON.stringify(response));

        const ewelinkSummary = response.ewelink ? ` eWelink=${response.ewelink.online}/${response.ewelink.devices}` : '';
        const tuyaSummary = response.tuya ? ` Tuya=${response.tuya.online}/${response.tuya.devices}` : '';
        console.log(`[Puente Unificado] Refresco manual OK:${ewelinkSummary}${tuyaSummary}`);
    } catch (error) {
        client.publish(BRIDGE_REFRESH_STATUS_TOPIC, JSON.stringify({
            status: 'error',
            command,
            error: error.message,
            ts: new Date().toISOString()
        }));
        console.error('[Puente Unificado] Error en refresco manual:', error.message);
    }
}

function publicarEstadoEwelink(client) {
    const equipos = ewelinkManager.getEquipos();
    equipos.forEach(equipo => {
        client.publish(`${MQTT_PREFIX}/${equipo.id}/available`, equipo.online ? 'online' : 'offline', { retain: true });
        client.publish(`${MQTT_PREFIX}/${equipo.id}/config`, JSON.stringify(equipo), { retain: true });
    });
}

function publicarEstadoTuya(client) {
    const equipos = tuyaManager.getEquipos();
    equipos.forEach(equipo => {
        client.publish(`${MQTT_PREFIX}/${equipo.botId}/available`, equipo.online ? 'online' : 'offline', { retain: true });
        client.publish(`${MQTT_PREFIX}/${equipo.botId}/config`, JSON.stringify(equipo), { retain: true });
    });
}

/**
 * Parsea el payload de tasmota/discovery/<mac>/config y publica
 * un objeto de config limpio en luces/<topic>/config.
 */
function publicarConfigTasmota(client, rawMessage) {
    try {
        const data = JSON.parse(rawMessage);
        const deviceTopic = data.t;
        if (!deviceTopic) return;

        const friendlyName = (Array.isArray(data.fn) ? data.fn[0] : null) || data.dn || deviceTopic;
        const config = {
            id:       deviceTopic,
            nombre:   friendlyName,
            name:     friendlyName,
            source:   'tasmota',
            topic:    deviceTopic,
            hostname: data.hn  || null,
            ip:       data.ip  || null,
            mac:      data.mac || null,
            modelo:   data.md  || null,
            firmware: data.sw  || null,
        };

        client.publish(`${MQTT_PREFIX}/${deviceTopic}/config`,    JSON.stringify(config), { retain: true });
        console.log(`[Tasmota Bridge] 📋 Config publicada: ${deviceTopic} ("${config.nombre}", ${config.ip || '?'})`);
    } catch (e) {
        console.warn('[Tasmota Bridge] Error parseando discovery payload:', e.message);
    }
}

function imprimirDirectorioConsola() {
    const equiposEwelink = ewelinkManager.getEquipos();
    const equiposTuya = tuyaManager.getEquipos();

    console.log('\n========================================================================');
    console.log('📋 DIRECTORIO UNIFICADO DE DISPOSITIVOS DISPONIBLES EN MQTT');
    console.log('========================================================================');

    console.log('\n🔹 EQUIPOS EWELINK:');
    if (equiposEwelink.length === 0) {
        console.log('  (Ninguno detectado)');
    } else {
        equiposEwelink.forEach(e => {
            console.log(`  - [${e.nombre}] (ID: ${e.id})`);
            console.log(`    👉 Estado:   ${MQTT_PREFIX}/${e.id}/state  (Lectura)`);
            console.log(`    👉 Control:  ${MQTT_PREFIX}/${e.id}/set    (Escritura: 'on' / 'off')`);
        });
    }

    console.log('\n🔹 EQUIPOS TUYA:');
    if (equiposTuya.length === 0) {
        console.log('  (Ninguno detectado en tuya-devices.json)');
    } else {
        equiposTuya.forEach(e => {
            const name = e.nombre || e.name || e.id;
            console.log(`  - [${name}] (ID: ${e.botId})`);
            console.log(`    👉 Estado:   ${MQTT_PREFIX}/${e.botId}/state  (Lectura)`);
            console.log(`    👉 Control:  ${MQTT_PREFIX}/${e.botId}/set    (Escritura: 'on' / 'off')`);
        });
    }

    console.log('\n🔹 EQUIPOS TASMOTA (Descubiertos dinámicamente):');
    console.log(`    👉 Estado:   ${MQTT_PREFIX}/<topic>/state  (Lectura)`);
    console.log(`    👉 Control:  ${MQTT_PREFIX}/<topic>/set    (Escritura: 'on' / 'off')`);
    console.log('    (Ejemplo para dispositivo "oficina": luces/oficina/set)');
    console.log('========================================================================\n');
}

startBridge().catch(err => {
    console.error('❌ Error fatal al iniciar el puente:', err);
});
