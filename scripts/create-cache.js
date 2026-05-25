import Zeroconf from '@pipechela/ewelink-api/src/classes/Zeroconf.js'
import eWelink from "@pipechela/ewelink-api";
import dotenv from 'dotenv';
import os from 'os';

dotenv.config();

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return null;
}

const { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } = process.env;

const conn = new eWelink({
    email: EWELINK_EMAIL,
    password: EWELINK_PASSWORD,
    APP_ID: APP_ID,
    APP_SECRET: APP_SECRET
})

console.log('Descargando y guardando caché de dispositivos eWelink...');
await conn.saveDevicesCache()

const localIp = getLocalIp();
if (localIp) {
    console.log(`Generando y guardando tabla ARP desde IP local: ${localIp}...`);
    await Zeroconf.saveArpTable({
        ip: localIp
    })
    console.log('Tabla ARP guardada exitosamente.');
} else {
    console.warn('⚠️ No se pudo determinar la IP local para el escaneo ARP.');
}