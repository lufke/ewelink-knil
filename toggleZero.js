import Zeroconf from '@pipechela/ewelink-api/src/classes/Zeroconf.js'
import eWelink from "@pipechela/ewelink-api";
import { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } from "./conifg.js";


const devices = await Zeroconf.loadCachedDevices()
const arpTable = await Zeroconf.loadArpTable()

// console.log(devices)
console.log(arpTable)

// const conn = new eWelink({ devices, arpTable, APP_ID:APP_ID, APP_SECRET:APP_SECRET })

// const equipos = await conn.getDevices()
// console.log(equipos)