import mqtt from 'mqtt';
import manager from './ewelink-manager.js';
import dotenv from 'dotenv';

dotenv.config();

const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost';
const MQTT_TOPIC_PREFIX = 'ewelink';

async function startBridge() {
    console.log('--- Iniciando Puente eWelink a MQTT ---');

    // Inicializar el manager de eWelink (carga cache y tabla ARP)
    const initialized = await manager.init();
    if (!initialized) {
        console.error('No se pudo inicializar el manager de eWelink. Verifica los archivos de cache.');
        process.exit(1);
    }

    const client = mqtt.connect(MQTT_BROKER);

    client.on('connect', () => {
        console.log(`Conectado al broker MQTT: ${MQTT_BROKER}`);

        // Suscribirse a los comandos para todos los dispositivos
        // Formato: ewelink/deviceid/set
        client.subscribe(`${MQTT_TOPIC_PREFIX}/+/set`, (err) => {
            if (!err) {
                console.log(`Suscrito a ${MQTT_TOPIC_PREFIX}/+/set`);
            }
        });

        // Publicar estado inicial de los equipos
        publicarEstadoEquipos(client);
    });

    client.on('message', async (topic, message) => {
        const parts = topic.split('/');
        if (parts.length === 3 && parts[0] === MQTT_TOPIC_PREFIX && parts[2] === 'set') {
            const deviceId = parts[1];
            const state = message.toString().toLowerCase(); // 'on' o 'off'

            if (state !== 'on' && state !== 'off') {
                console.warn(`Estado inválido recibido: ${state}. Solo se permite 'on' u 'off'.`);
                return;
            }

            console.log(`MQTT -> Recibido comando '${state}' para dispositivo ${deviceId}`);

            try {
                const response = await manager.setPowerState(deviceId, state);

                if (response.status === 'ok' || response.state === state) {
                    console.log(`Local -> Dispositivo ${deviceId} cambiado a ${state}`);
                    // Informar el nuevo estado de vuelta a MQTT
                    client.publish(`${MQTT_TOPIC_PREFIX}/${deviceId}/state`, state, { retain: true });
                } else {
                    console.error(`Local -> Error al cambiar estado de ${deviceId}:`, response);
                }
            } catch (error) {
                console.error(`Local -> Error en la comunicación local con ${deviceId}:`, error.message);
            }
        }
    });

    client.on('error', (err) => {
        console.error('Error en cliente MQTT:', err);
    });
}

function publicarEstadoEquipos(client) {
    const equipos = manager.getEquipos();
    console.log(`Publicando información detallada para ${equipos.length} equipos...`);

    equipos.forEach(equipo => {
        // Tópico de disponibilidad
        client.publish(`${MQTT_TOPIC_PREFIX}/${equipo.id}/available`, 'online', { retain: true });

        // Tópico con todos los detalles en formato JSON (nombre, mac, ip, modelo, etc)
        const info = JSON.stringify(equipo);
        client.publish(`${MQTT_TOPIC_PREFIX}/${equipo.id}/config`, info, { retain: true });

        // Tópico con el estado actual (on/off)
        client.publish(`${MQTT_TOPIC_PREFIX}/${equipo.id}/state`, equipo.estado, { retain: true });

        console.log(`[${equipo.id}] ${equipo.nombre} adaptado a MQTT (Estado: ${equipo.estado}).`);
    });
}

startBridge().catch(err => {
    console.error('Error fatal al iniciar el puente:', err);
});
