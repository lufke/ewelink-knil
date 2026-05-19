import ewelink from '@pipechela/ewelink-api';

const kuky = {
    accessToken: '1ffdb8e9e22c5730e2c3aac2179b2da99226eb00',
    apikey: '6eb72ae9-9d56-417d-a8a0-e9797c99354c',
    region: 'us'
}

const listado = async () => {
    console.log('Conectando a eWelink...');
    const newConnection = new ewelink({
        at: kuky.accessToken,
        region: kuky.region,
        // APP_ID: 'Uw83EKZFxdif7XFXEsrpduz5YyjP7nTl',
        // APP_SECRET: 'mXLOjea0woSMvK9gw7Fjsy7YlFO4iSu6'
    });

    const devices = await newConnection.getDevices();
    console.log(devices)
    const luces = devices.map((item, index) => {
        return {
            nombre: item.name,
            deviceId: item.deviceid,
            rssi: item.params.rssi,
            ssid: item.params.ssid,
            estado: item.params.switch,
        }
    })
    console.log(luces);
    // console.log(devices[devices.length - 1]);
    const state = await newConnection.getDevicePowerState(devices[devices.length - 1].deviceid)
    // console.log(state)
}

listado()