import Zeroconf from '@pipechela/ewelink-api/src/classes/Zeroconf.js'
import eWelink from "@pipechela/ewelink-api";
import dotenv from 'dotenv';
dotenv.config();

const { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } = process.env;

const conn = new eWelink({
    email: EWELINK_EMAIL,
    password: EWELINK_PASSWORD,
    APP_ID: APP_ID,
    APP_SECRET: APP_SECRET
})

await conn.saveDevicesCache()


await Zeroconf.saveArpTable({
    ip: '192.168.1.28'
})