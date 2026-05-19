import manager from './tasmota-manager.js';

async function main() {
    console.log('--- Gestor de Dispositivos Tasmota ---');

    const ready = await manager.init();
    if (!ready) {
        console.error('No se pudo conectar al broker MQTT.');
        process.exit(1);
    }

    // Esperar un momento para recibir estados iniciales
    setTimeout(async () => {
        const equipos = manager.getEquipos();
        console.log('\nEquipos detectados:');
        equipos.forEach(e => {
            console.log(`- ${e.nombre} [${e.id}] | Tópico: ${e.topic} | Estado: ${e.estado}`);
        });

        // Ejemplo de uso:
        // Si hay equipos, intentar encender el primero despues de 2 seg y apagarlo despues de 4
        if (equipos.length > 0) {
            const primero = equipos[0];

            console.log(`\nProbando control sobre: ${primero.nombre}`);

            console.log('Encendiendo...');
            await manager.setPowerState(primero.id, 'ON');

            setTimeout(async () => {
                console.log('Apagando...');
                await manager.setPowerState(primero.id, 'OFF');
                console.log('Prueba terminada.');
                process.exit(0);
            }, 3000);
        } else {
            console.log('\nNo hay equipos configurados en tasmota-devices.json');
            process.exit(0);
        }
    }, 2000);
}

main().catch(console.error);
