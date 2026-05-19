# eWelink, Tasmota & Tuya IoT Manager (ewelink-knil)

Un sistema integrado en Node.js para controlar y gestionar dispositivos inteligentes **eWelink** (Sonoff, etc.), **Tasmota** y **Tuya**. Permite el control dual a través de un **Bot de Telegram** interactivo y un **Puente MQTT** (Bridge) para integración con otros sistemas domésticos como Home Assistant.

## 🚀 Características Principales

*   **Gestor eWelink (LAN + Cloud):** Controla tus dispositivos eWelink primariamente a través de la red local (LAN) mediante Zeroconf/ARP para mayor rapidez. Si el dispositivo no responde en local, hace un *fallback* automático a la nube (Cloud).
*   **Integración Tasmota:** Descubrimiento automático de dispositivos Tasmota en la red utilizando MQTT y control de sus estados.
*   **Integración Tuya (Control Local):** Control local de dispositivos Tuya (ampolletas, enchufes, interruptores de múltiples canales) mediante `tuyapi`, permitiendo conmutar canales (DPS) de manera instantánea y local.
*   **Bot de Telegram interactivo:** Un bot completo creado con Telegraf que te permite:
    *   Listar todos los equipos descubiertos (`/luces`).
    *   Controlar el estado (ON/OFF) mediante botones interactivos (Inline Keyboard).
    *   Refrescar la caché y redescubrir dispositivos (`/refresh`).
*   **Puente MQTT (eWelink + Tuya a MQTT):** Expone tus dispositivos eWelink y Tuya locales hacia un broker MQTT, publicando su disponibilidad, información y estado, y permitiendo su control vía MQTT.

## 📋 Requisitos

*   [Node.js](https://nodejs.org/) (v20 o superior recomendado)
*   Un broker MQTT (ej. Mosquitto) funcionando local o remotamente.
*   Un token de Bot de Telegram (obtenido a través de [@BotFather](https://t.me/botfather)).
*   Credenciales de tu cuenta eWelink.
*   Credenciales de API de desarrollo de Tuya (solo para obtener las llaves locales por primera vez).

## 🛠️ Instalación

1. Clona el repositorio o descarga el código.
2. Instala las dependencias de Node:
   ```bash
   npm install
   ```
3. Crea un archivo `.env` en la raíz del proyecto basándote en la siguiente configuración:

   ```env
   # Credenciales eWelink
   EWELINK_EMAIL=tu_correo@email.com
   EWELINK_PASSWORD=tu_contraseña
   APP_ID=tu_app_id_opcional
   APP_SECRET=tu_app_secret_opcional

   # Configuración de Telegram
   BOT_TOKEN=tu_token_de_telegram_bot

   # Configuración MQTT
   MQTT_BROKER=mqtt://localhost:1883

   # Configuración Ngrok (Opcional)
   NGROK_AUTH_TOKEN=tu_token_de_ngrok
   ```

4. Configura tus dispositivos Tuya en `tuya-devices.json`. Para obtener las llaves locales, puedes usar la herramienta de ayuda del asistente:
   ```bash
   npx @tuyapi/cli wizard
   ```

## 🚀 Uso

El proyecto tiene múltiples scripts dependiendo de la funcionalidad que desees ejecutar.

### 🤖 Bot de Telegram
Para iniciar el bot interactivo de Telegram y gestionar tus dispositivos desde el chat:
```bash
npm run bot
```
**Comandos del Bot:**
*   `/luces` - Lista todos los equipos descubiertos (eWelink, Tasmota y Tuya) con botones para encender/apagar.
*   `/refresh` - Fuerza la actualización de la caché de eWelink (escaneo de IPs por ARP) y solicita estados de Tasmota.
*   `/ping` - Comprueba que el bot está activo.

### 🌉 Puente MQTT (Bridge)
Para exponer tus dispositivos eWelink y Tuya al broker MQTT:
```bash
npm run mqtt
```
*   **eWelink Tópicos:**
    *   **Estado:** `ewelink/<device_id>/state` (retains `on`/`off`)
    *   **Control:** `ewelink/<device_id>/set` (enviar `on` u `off`)
*   **Tuya Tópicos:**
    *   **Estado:** `tuya/<device_id>_<dps>/state` (retains `on`/`off`)
    *   **Control:** `tuya/<device_id>_<dps>/set` (enviar `on` u `off`)

### 🔌 Scripts adicionales
*   `npm run tasmota` - Ejecuta comandos de control manual para Tasmota (`tasmota-control.js`).
*   `npm run tasmota:discovery` - Ejecuta el script de auto-descubrimiento manual de Tasmota (`tasmota-discovery.js`).

## 📦 Estructura del Proyecto

*   `bot.js`: Lógica principal del Bot de Telegram usando Telegraf.
*   `ewelink-manager.js`: Clase encargada de manejar eWelink (LAN + Cloud).
*   `tasmota-manager.js`: Clase encargada de la comunicación MQTT con dispositivos Tasmota.
*   `tuya-manager.js`: Clase encargada del control local y directo de dispositivos Tuya.
*   `tuya-devices.json`: Archivo de configuración (excluido de git) donde se configuran los IDs, llaves locales, canales y opcionalmente IPs estáticas de tus dispositivos Tuya.
*   `mqtt-bridge.js`: Puente para sincronizar el estado y comandos de eWelink y Tuya con tu broker MQTT local.
*   `devices-cache.json` & `arp-table.json`: Archivos temporales generados automáticamente que actúan como caché de la red y dispositivos eWelink locales.

## 🤝 Dependencias Principales
*   [`@pipechela/ewelink-api`](https://www.npmjs.com/package/@pipechela/ewelink-api) - Cliente para eWelink API
*   [`telegraf`](https://telegraf.js.org/) - Framework para Bots de Telegram
*   [`mqtt`](https://www.npmjs.com/package/mqtt) - Cliente MQTT para Node.js
*   [`tuyapi`](https://www.npmjs.com/package/tuyapi) - Cliente de control local para dispositivos Tuya/SmartLife
*   [`dotenv`](https://www.npmjs.com/package/dotenv) - Manejo de variables de entorno

## 📝 Licencia
ISC
