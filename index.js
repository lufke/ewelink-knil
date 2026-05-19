// import eWelink from "ewelink-api";
import ewelink from '@pipechela/ewelink-api';
import dotenv from 'dotenv';
dotenv.config();

const { APP_ID, APP_SECRET, EWELINK_EMAIL, EWELINK_PASSWORD } = process.env;

const ewelinkUser = {
    accessToken: '',
    apikey: '',
    region: 'us'
}

const inicio = async () => {
    // let email = 'pipechela@gmail.com'
    let email = EWELINK_EMAIL
    let password = EWELINK_PASSWORD
    const connection = new ewelink({
        email,
        password,
        APP_ID: APP_ID,
        APP_SECRET: APP_SECRET
    });
    try {
        const credentials = await connection.getCredentials()
        ewelinkUser.accessToken = credentials.at
        ewelinkUser.apikey = credentials.user.apikey
        console.log(ewelinkUser)
        // console.log(credentials)
        const devices = await connection.getDevices()
        console.log(devices)
    } catch (error) {
        console.error(error)
    }

    // await connection.login()
}

inicio()