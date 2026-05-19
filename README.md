# eWelink & Tasmota IoT Manager (ewelink-knil)

Un sistema integrado en Node.js para controlar y gestionar dispositivos inteligentes **eWelink** (Sonoff, etc.) y **Tasmota**. Permite el control dual a través de un **Bot de Telegram** interactivo y un **Puente MQTT** (Bridge) para integración con otros sistemas domésticos como Home Assistant.

## 🚀 Características Principales

*   **Gestor eWelink (LAN + Cloud):** Controla tus dispositivos eWelink primariamente a través de la red local (LAN) mediante Zeroconf/ARP para mayor rapidez. Si el dispositivo no responde en local, hace un *fallback* automático a la nube (Cloud).
*   **Integración Tasmota:** Descubrimiento automático de dispositivos Tasmota en la red utilizando MQTT y control de sus estados.
*   **Bot de Telegram interactivo:** Un bot completo creado con Telegraf que te permite:
    *   Listar todos los equipos disponibles (`/ewelink`).
    *   Controlar el estado (ON/OFF) mediante botones interactivos (Inline Keyboard).
    *   Refrescar la caché y redescubrir dispositivos (`/refresh`).
*   **Puente MQTT (eWelink a MQTT):** Expone tus dispositivos eWelink locales hacia un broker MQTT, publicando su disponibilidad, información y estado, y permitiendo su control vía MQTT (suscrito a `ewelink/+/set`).

## 📋 Requisitos

*   [Node.js](https://nodejs.org/) (v16 o superior recomendado)
*   Un broker MQTT (ej. Mosquitto) funcionando local o remotamente.
*   Un token de Bot de Telegram (obtenido a través de [@BotFather](https://t.me/botfather)).
*   Credenciales de tu cuenta eWelink.

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
   MQTT_BROKER=mqtt://localhost
   ```

## 🚀 Uso

El proyecto tiene múltiples scripts dependiendo de la funcionalidad que desees ejecutar.

### 🤖 Bot de Telegram
Para iniciar el bot interactivo de Telegram y gestionar tus dispositivos desde el chat:
```bash
npm run bot
```
**Comandos del Bot:**
*   `/ewelink` - Lista todos los equipos descubiertos (eWelink y Tasmota) con botones para encender/apagar.
*   `/refresh` - Fuerza la actualización de la caché de eWelink (escaneo de IPs por ARP) y Tasmota.
*   `/ping` - Comprueba que el bot está activo.

### 🌉 Puente MQTT (eWelink Bridge)
Para exponer tus dispositivos eWelink al broker MQTT:
```bash
npm run mqtt
```
*   **Tópicos de estado:** `ewelink/<device_id>/state`
*   **Tópicos de control:** `ewelink/<device_id>/set` (enviando `on` u `off`)

### 🔌 Scripts adicionales
*   `npm run tasmota` - Ejecuta comandos de control manual para Tasmota (`tasmota-control.js`).
*   `npm run tasmota:discovery` - Ejecuta el script de auto-descubrimiento manual de Tasmota (`tasmota-discovery.js`).

## 📦 Estructura del Proyecto

*   `bot.js`: Lógica principal del Bot de Telegram usando Telegraf.
*   `ewelink-manager.js`: Clase encargada de manejar la autenticación, caché (ARP/JSON) y el envío de comandos dual (LAN/Cloud) a la API de eWelink.
*   `tasmota-manager.js`: Clase encargada de la suscripción, descubrimiento y publicación de comandos vía MQTT a dispositivos Tasmota.
*   `mqtt-bridge.js`: Puente para sincronizar el estado y comandos de eWelink con tu broker MQTT local.
*   `devices-cache.json` & `arp-table.json`: Archivos generados automáticamente que actúan como caché de la red y dispositivos locales para evitar peticiones redundantes.

## 🤝 Dependencias Principales
*   [`@pipechela/ewelink-api`](https://www.npmjs.com/package/@pipechela/ewelink-api) - Cliente para eWelink API
*   [`telegraf`](https://telegraf.js.org/) - Framework para Bots de Telegram
*   [`mqtt`](https://www.npmjs.com/package/mqtt) - Cliente MQTT para Node.js
*   [`dotenv`](https://www.npmjs.com/package/dotenv) - Manejo de variables de entorno

## 📝 Licencia
ISC
