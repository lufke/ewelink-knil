import mqtt from 'mqtt';
import ewelinkManager from './ewelink-manager.js';
import tuyaManager from './tuya-manager.js';
import tasmotaManager from './tasmota-manager.js';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost';
const EWELINK_PREFIX = 'ewelink';
const TUYA_PREFIX = 'tuya';
const TASMOTA_PREFIX = 'tasmota';

async function startBridge() {
    console.log('--- Iniciando Puente IoT Unificado (eWelink + Tuya + Tasmota) a MQTT ---');

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

    client.on('connect', () => {
        console.log(`✅ Puente MQTT conectado al broker: ${MQTT_BROKER}`);

        // Suscribirse a comandos de eWelink (ewelink/+/set)
        client.subscribe(`${EWELINK_PREFIX}/+/set`, (err) => {
            if (!err) console.log(`📡 Suscrito a comandos: ${EWELINK_PREFIX}/+/set`);
        });

        // Suscribirse a comandos de Tuya (tuya/+/set)
        client.subscribe(`${TUYA_PREFIX}/+/set`, (err) => {
            if (!err) console.log(`📡 Suscrito a comandos: ${TUYA_PREFIX}/+/set`);
        });

        // Suscribirse a comandos unificados de Tasmota (tasmota/+/set)
        client.subscribe(`${TASMOTA_PREFIX}/+/set`, (err) => {
            if (!err) console.log(`📡 Suscrito a comandos: ${TASMOTA_PREFIX}/+/set`);
        });

        // Escuchar los reportes nativos de Tasmota para reflejarlos en nuestro tópico unificado
        client.subscribe('stat/+/POWER', (err) => {
            if (!err) console.log(`📡 Escuchando reportes nativos: stat/+/POWER`);
        });

        // Publicar estado inicial de los equipos
        publicarEstadoEwelink(client);
        publicarEstadoTuya(client);

        // Imprimir directorio unificado en consola
        imprimirDirectorioConsola();
    });

    client.on('message', async (topic, message) => {
        const payload = message.toString().toLowerCase();

        // --- 1. Caso: Reportes nativos de Tasmota (stat/+/POWER) ---
        if (topic.startsWith('stat/') && topic.endsWith('/POWER')) {
            const parts = topic.split('/');
            const deviceTopic = parts[1]; // ej: "oficina"
            if (deviceTopic) {
                // Reflejamos el estado en el tópico unificado tasmota/oficina/state
                client.publish(`${TASMOTA_PREFIX}/${deviceTopic}/state`, payload, { retain: true });
                client.publish(`${TASMOTA_PREFIX}/${deviceTopic}/available`, 'online', { retain: true });
                console.log(`[Tasmota Bridge] Reflejando estado: ${deviceTopic} -> ${payload}`);
            }
            return;
        }

        // --- 2. Caso: Comandos unificados (set) ---
        const parts = topic.split('/');
        if (parts.length !== 3 || parts[2] !== 'set') return;

        const prefix = parts[0];
        const deviceId = parts[1];

        if (payload !== 'on' && payload !== 'off') {
            console.warn(`⚠️ Estado inválido recibido en ${topic}: ${payload}. Solo se permite 'on' u 'off'.`);
            return;
        }

        // CONTROL EWELINK
        if (prefix === EWELINK_PREFIX) {
            console.log(`[eWelink MQTT] -> Recibido comando '${payload}' para dispositivo ${deviceId}`);
            try {
                const response = await ewelinkManager.setPowerState(deviceId, payload);
                if (response.status === 'ok' || response.state === payload) {
                    console.log(`[eWelink MQTT] Local -> Dispositivo ${deviceId} cambiado a ${payload}`);
                    client.publish(`${EWELINK_PREFIX}/${deviceId}/state`, payload, { retain: true });
                } else {
                    console.error(`[eWelink MQTT] Local -> Error al cambiar estado de ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`[eWelink MQTT] Local -> Error en la comunicación con ${deviceId}:`, error.message);
            }
        } 
        
        // CONTROL TUYA
        else if (prefix === TUYA_PREFIX) {
            console.log(`[Tuya MQTT] -> Recibido comando '${payload}' para dispositivo ${deviceId}`);
            try {
                const response = await tuyaManager.setPowerState(deviceId, payload);
                if (response.status === 'ok') {
                    console.log(`[Tuya MQTT] Local -> Dispositivo ${deviceId} cambiado a ${payload}`);
                    client.publish(`${TUYA_PREFIX}/${deviceId}/state`, payload, { retain: true });
                } else {
                    console.error(`[Tuya MQTT] Local -> Error al cambiar estado de ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`[Tuya MQTT] Local -> Error en la comunicación con ${deviceId}:`, error.message);
            }
        }

        // CONTROL TASMOTA
        else if (prefix === TASMOTA_PREFIX) {
            console.log(`[Tasmota MQTT] -> Recibido comando '${payload}' para dispositivo ${deviceId}`);
            try {
                const response = await tasmotaManager.setPowerState(deviceId, payload);
                if (response.status === 'ok') {
                    console.log(`[Tasmota MQTT] Local -> Comando de encendido/apagado enviado a Tasmota ${deviceId}`);
                    // El estado se actualizará automáticamente cuando el dispositivo responda en stat/+/POWER
                } else {
                    console.error(`[Tasmota MQTT] Local -> Error enviando comando a Tasmota ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`[Tasmota MQTT] Local -> Error en la comunicación con Tasmota ${deviceId}:`, error.message);
            }
        }
    });

    client.on('error', (err) => {
        console.error('❌ Error en cliente MQTT del puente:', err);
    });
}

function publicarEstadoEwelink(client) {
    const equipos = ewelinkManager.getEquipos();
    equipos.forEach(equipo => {
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/available`, 'online', { retain: true });
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/config`, JSON.stringify(equipo), { retain: true });
        
        const est = equipo.estado ? equipo.estado.toLowerCase() : 'unknown';
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/state`, est, { retain: true });
    });
}

function publicarEstadoTuya(client) {
    const equipos = tuyaManager.getEquipos();
    equipos.forEach(equipo => {
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/available`, 'online', { retain: true });
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/config`, JSON.stringify(equipo), { retain: true });
        
        const est = equipo.estado ? equipo.estado.toLowerCase() : 'unknown';
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/state`, est, { retain: true });
    });
}

function imprimirDirectorioConsola() {
    const equiposEwelink = ewelinkManager.getEquipos();
    const equiposTuya = tuyaManager.getEquipos();

    console.log('\n========================================================================');
    console.log('📋 DIRECTORIO DE DISPOSITIVOS DISPONIBLES EN MQTT');
    console.log('========================================================================');

    console.log('\n🔹 EQUIPOS EWELINK:');
    if (equiposEwelink.length === 0) {
        console.log('  (Ninguno detectado)');
    } else {
        equiposEwelink.forEach(e => {
            console.log(`  - [${e.nombre}] (ID: ${e.id})`);
            console.log(`    👉 Estado:   ${EWELINK_PREFIX}/${e.id}/state  (Lectura)`);
            console.log(`    👉 Control:  ${EWELINK_PREFIX}/${e.id}/set    (Escritura: 'on' / 'off')`);
        });
    }

    console.log('\n🔹 EQUIPOS TUYA:');
    if (equiposTuya.length === 0) {
        console.log('  (Ninguno detectado en tuya-devices.json)');
    } else {
        equiposTuya.forEach(e => {
            const name = e.nombre || e.name || e.id;
            console.log(`  - [${name}] (ID: ${e.botId})`);
            console.log(`    👉 Estado:   ${TUYA_PREFIX}/${e.botId}/state  (Lectura)`);
            console.log(`    👉 Control:  ${TUYA_PREFIX}/${e.botId}/set    (Escritura: 'on' / 'off')`);
        });
    }

    console.log('\n🔹 EQUIPOS TASMOTA (Descubiertos dinámicamente):');
    console.log(`    👉 Estado:   ${TASMOTA_PREFIX}/<topic>/state  (Lectura)`);
    console.log(`    👉 Control:  ${TASMOTA_PREFIX}/<topic>/set    (Escritura: 'on' / 'off')`);
    console.log('    (Ejemplo para dispositivo "oficina": tasmota/oficina/set)');
    console.log('========================================================================\n');
}

startBridge().catch(err => {
    console.error('❌ Error fatal al iniciar el puente:', err);
});
