import manager from './tasmota-manager.js';

async function main() {
    console.log('--- Buscador Dinámico de Dispositivos Tasmota ---');
    console.log('Esperando mensajes MQTT para descubrir equipos...');

    const ready = await manager.init();
    if (!ready) {
        console.error('No se pudo conectar al broker MQTT.');
        process.exit(1);
    }

    // Intervalo para mostrar los equipos encontrados
    const interval = setInterval(() => {
        const equipos = manager.getEquipos();

        if (equipos.length > 0) {
            console.clear();
            console.log('--- Buscador Dinámico de Dispositivos Tasmota ---');
            console.log(`Equipos descubiertos: ${equipos.length}\n`);

            equipos.forEach(e => {
                const onlineStr = e.online ? '🟢 ONLINE' : '🔴 OFFLINE';
                console.log(`- [${e.topic}] ${onlineStr} | Estado: ${e.estado} | Visto: ${e.lastSeen.toLocaleTimeString()}`);
            });

            console.log('\nPresiona Ctrl+C para salir.');
        } else {
            process.stdout.write('.');
        }
    }, 2000);
}

main().catch(console.error);
