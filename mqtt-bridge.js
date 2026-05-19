import mqtt from 'mqtt';
import ewelinkManager from './ewelink-manager.js';
import tuyaManager from './tuya-manager.js';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost';
const EWELINK_PREFIX = 'ewelink';
const TUYA_PREFIX = 'tuya';

async function startBridge() {
    console.log('--- Iniciando Puente eWelink + Tuya a MQTT ---');

    // Inicializar el manager de eWelink (carga cache y tabla ARP)
    const ewelinkInitialized = await ewelinkManager.init();
    if (!ewelinkInitialized) {
        console.warn('⚠️ No se pudo inicializar el manager de eWelink. Verifica los archivos de cache.');
    }

    // TuyaManager se carga automáticamente al importarlo.

    const client = mqtt.connect(MQTT_BROKER);

    client.on('connect', () => {
        console.log(`✅ Conectado al broker MQTT: ${MQTT_BROKER}`);

        // Suscribirse a comandos de eWelink (ewelink/deviceid/set)
        client.subscribe(`${EWELINK_PREFIX}/+/set`, (err) => {
            if (!err) {
                console.log(`📡 Suscrito a ${EWELINK_PREFIX}/+/set`);
            }
        });

        // Suscribirse a comandos de Tuya (tuya/botId/set)
        client.subscribe(`${TUYA_PREFIX}/+/set`, (err) => {
            if (!err) {
                console.log(`📡 Suscrito a ${TUYA_PREFIX}/+/set`);
            }
        });

        // Publicar estado inicial de los equipos
        publicarEstadoEwelink(client);
        publicarEstadoTuya(client);
    });

    client.on('message', async (topic, message) => {
        const parts = topic.split('/');
        if (parts.length !== 3 || parts[2] !== 'set') return;

        const prefix = parts[0];
        const deviceId = parts[1];
        const state = message.toString().toLowerCase(); // 'on' o 'off'

        if (state !== 'on' && state !== 'off') {
            console.warn(`⚠️ Estado inválido recibido: ${state}. Solo se permite 'on' u 'off'.`);
            return;
        }

        if (prefix === EWELINK_PREFIX) {
            console.log(`[eWelink MQTT] -> Recibido comando '${state}' para dispositivo ${deviceId}`);
            try {
                const response = await ewelinkManager.setPowerState(deviceId, state);
                if (response.status === 'ok' || response.state === state) {
                    console.log(`[eWelink MQTT] Local -> Dispositivo ${deviceId} cambiado a ${state}`);
                    client.publish(`${EWELINK_PREFIX}/${deviceId}/state`, state, { retain: true });
                } else {
                    console.error(`[eWelink MQTT] Local -> Error al cambiar estado de ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`[eWelink MQTT] Local -> Error en la comunicación con ${deviceId}:`, error.message);
            }
        } 
        
        else if (prefix === TUYA_PREFIX) {
            console.log(`[Tuya MQTT] -> Recibido comando '${state}' para dispositivo ${deviceId}`);
            try {
                const response = await tuyaManager.setPowerState(deviceId, state);
                if (response.status === 'ok') {
                    console.log(`[Tuya MQTT] Local -> Dispositivo ${deviceId} cambiado a ${state}`);
                    client.publish(`${TUYA_PREFIX}/${deviceId}/state`, state, { retain: true });
                } else {
                    console.error(`[Tuya MQTT] Local -> Error al cambiar estado de ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`[Tuya MQTT] Local -> Error en la comunicación con ${deviceId}:`, error.message);
            }
        }
    });

    client.on('error', (err) => {
        console.error('❌ Error en cliente MQTT:', err);
    });
}

function publicarEstadoEwelink(client) {
    const equipos = ewelinkManager.getEquipos();
    console.log(`[eWelink MQTT] Publicando información detallada para ${equipos.length} equipos...`);

    equipos.forEach(equipo => {
        // Tópico de disponibilidad
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/available`, 'online', { retain: true });

        // Tópico con todos los detalles en formato JSON (nombre, mac, ip, modelo, etc)
        const info = JSON.stringify(equipo);
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/config`, info, { retain: true });

        // Tópico con el estado actual (on/off)
        client.publish(`${EWELINK_PREFIX}/${equipo.id}/state`, equipo.estado, { retain: true });

        console.log(`[eWelink MQTT] [${equipo.id}] ${equipo.nombre} expuesto a MQTT (Estado: ${equipo.estado}).`);
    });
}

function publicarEstadoTuya(client) {
    const equipos = tuyaManager.getEquipos();
    console.log(`[Tuya MQTT] Publicando información detallada para ${equipos.length} equipos...`);

    equipos.forEach(equipo => {
        const name = equipo.nombre || equipo.name || equipo.id;
        
        // Tópico de disponibilidad
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/available`, 'online', { retain: true });

        // Tópico con todos los detalles en formato JSON (nombre, id, dps, etc)
        const info = JSON.stringify(equipo);
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/config`, info, { retain: true });

        // Tópico con el estado actual (on/off)
        client.publish(`${TUYA_PREFIX}/${equipo.botId}/state`, equipo.estado, { retain: true });

        console.log(`[Tuya MQTT] [${equipo.botId}] ${name} expuesto a MQTT (Estado: ${equipo.estado}).`);
    });
}

startBridge().catch(err => {
    console.error('❌ Error fatal al iniciar el puente:', err);
});
