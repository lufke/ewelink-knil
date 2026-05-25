import manager from '../src/managers/tasmota-manager.js';

async function main() {
    console.log('--- 🔍 Buscador de Dispositivos Tasmota ---');
    console.log('Escuchando tópicos de discovery y telemetría MQTT...\n');

    const ready = await manager.init();
    if (!ready) {
        console.error('❌ No se pudo conectar al broker MQTT.');
        process.exit(1);
    }

    // Mostrar tabla de equipos cada 3 segundos
    setInterval(() => {
        const equipos = manager.getEquipos();

        console.clear();
        console.log('--- 🔍 Buscador de Dispositivos Tasmota ---');
        console.log(`Equipos descubiertos: ${equipos.length}  |  ${new Date().toLocaleTimeString()}\n`);

        if (equipos.length === 0) {
            process.stdout.write('Esperando mensajes MQTT');
            return;
        }

        const col = (str, w) => String(str ?? '?').padEnd(w).slice(0, w);

        console.log(
            col('TOPIC', 18) +
            col('NOMBRE', 22) +
            col('ESTADO', 8) +
            col('IP', 16) +
            col('MODELO', 16) +
            col('FIRMWARE', 10) +
            'ONLINE'
        );
        console.log('─'.repeat(100));

        equipos.forEach(e => {
            const online = e.online ? '🟢' : '🔴';
            console.log(
                col(e.topic,    18) +
                col(e.nombre,   22) +
                col(e.estado,    8) +
                col(e.ip,       16) +
                col(e.modelo,   16) +
                col(e.firmware, 10) +
                online
            );
        });

        console.log('\nPresiona Ctrl+C para salir.');
    }, 3000);
}

main().catch(console.error);
