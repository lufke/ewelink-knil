# eWelink, Tasmota & Tuya — MQTT Bridge (ewelink-knil)

Un puente IoT en Node.js que expone dispositivos **eWelink** (Sonoff, etc.), **Tasmota** y **Tuya** hacia un broker **MQTT** con tópicos unificados, facilitando la integración con Home Assistant y cualquier otro cliente MQTT.

## 🚀 Características

- **Gestor eWelink (LAN + Cloud):** Control primario vía red local (Zeroconf/ARP). Al iniciar recarga la tabla ARP para resolver IPs nuevas después de cortes de luz y la refresca periódicamente. Si el dispositivo no responde en LAN, hace *fallback* automático a la nube con timeout configurable para no bloquear si no hay Internet.
- **Integración Tasmota:** Descubrimiento enriquecido mediante el tópico nativo `tasmota/discovery/+/config` (nombre real, IP, modelo, firmware) y seguimiento de estado en tiempo real vía `tele/+/LWT`, `stat/+/POWER` y `tele/+/STATE`.
- **Integración Tuya (Control Local):** Control local de dispositivos Tuya mediante `tuyapi`, con soporte para múltiples canales (DPS), conexión persistente, disponibilidad `online/offline` y redescubrimiento de IP por UDP cuando cambia la red.
- **Estados físicos reales:** eWelink y Tuya publican `state` solo cuando se detecta un cambio físico real. Los comandos MQTT no se republcan como estado confirmado.
- **Refresco manual por MQTT:** Permite solicitar recarga de ARP eWelink y redescubrimiento Tuya desde cualquier cliente MQTT después de cortes de luz o cambios de IP.
- **Tópicos MQTT unificados:** Todos los dispositivos (sin importar la marca) quedan disponibles bajo el prefijo `luces/<id>/`.

## 📋 Requisitos

- [Node.js](https://nodejs.org/) v20 o superior
- Un broker MQTT (ej. Mosquitto) corriendo local o remotamente
- Credenciales de tu cuenta eWelink
- Credenciales locales de tus dispositivos Tuya (`id` + `key`)

## 🛠️ Instalación

1. Clona el repositorio e instala dependencias:
   ```bash
   npm install
   ```

2. Crea el archivo `.env` en la raíz del proyecto:
   ```env
   # Credenciales eWelink
   EWELINK_EMAIL=tu_correo@email.com
   EWELINK_PASSWORD=tu_contraseña
   APP_ID=tu_app_id
   APP_SECRET=tu_app_secret

   # Broker MQTT
   MQTT_BROKER=mqtt://localhost:1883

   # Refresco periódico de ARP para eWelink (milisegundos)
   EWELINK_ARP_REFRESH_INTERVAL_MS=300000

   # Cloud eWelink opcional
   EWELINK_CLOUD_ENABLED=true
   EWELINK_CLOUD_TIMEOUT_MS=7000
   ```

3. Configura tus dispositivos Tuya en `tuya-devices.json` (ver ejemplo en `.env.example`). Para obtener las llaves locales:
   ```bash
   npx @tuyapi/cli wizard
   ```

4. Genera la caché inicial de dispositivos eWelink:
   ```bash
   npm run cache
   ```

## 🚀 Uso

### Desarrollo (con recarga automática)
```bash
npm run dev
```

### Producción (Node directo)
```bash
npm run start
```

### Producción con PM2 (recomendado en Raspberry Pi)
```bash
# Instalar PM2 globalmente si no lo tienes
sudo npm install -g pm2

# Iniciar el bridge
pm2 start ecosystem.config.cjs

# Habilitar inicio automático al encender la Raspberry
pm2 startup
pm2 save
```

## 🌉 Esquema MQTT

Todos los dispositivos quedan accesibles bajo el prefijo `luces/`:

| Tópico | Dirección | Descripción |
|--------|-----------|-------------|
| `luces/<id>/set` | Escritura | Enviar `on` u `off` para controlar el dispositivo |
| `luces/<id>/state` | Lectura | Estado físico real (`on` / `off`) — retenido |
| `luces/<id>/available` | Lectura | Disponibilidad (`online` / `offline`) — retenido |
| `luces/<id>/config` | Lectura | Metadatos del dispositivo en JSON — retenido |
| `luces/_bridge/refresh` | Escritura | Solicita refresco manual (`arp`, `ewelink`, `tuya` o `all`) |
| `luces/_bridge/refresh/status` | Lectura | Resultado JSON del último refresco manual |

### Estado vs disponibilidad

- `luces/<id>/state` se publica cuando el bridge detecta un cambio real del equipo: mDNS/local para eWelink, TCP persistente para Tuya y `stat/+/POWER` para Tasmota.
- Al reiniciar la app no se republica el estado retenido de eWelink/Tuya para evitar falsos cambios.
- `luces/<id>/available` indica si el equipo está alcanzable localmente. eWelink usa ARP/mDNS, Tuya usa la conexión TCP persistente/redescubrimiento UDP y Tasmota usa `tele/+/LWT`.
- `EWELINK_ARP_REFRESH_INTERVAL_MS` controla cada cuánto se recarga la tabla ARP de eWelink. El valor por defecto en la app es `60000` ms si no se define.

### Operación sin Internet

- Tuya y Tasmota siguen funcionando localmente si el broker MQTT está en la red local.
- eWelink arranca con LAN/ARP aunque Cloud no responda. La autenticación Cloud se corta por timeout y no bloquea el inicio.
- `EWELINK_CLOUD_TIMEOUT_MS` define cuánto espera eWelink Cloud antes de continuar en modo local. Por defecto son `7000` ms.
- `EWELINK_CLOUD_ENABLED=false` desactiva completamente el login y fallback Cloud para operar solo por LAN.
- `npm run cache` y `refreshCache()` completo de eWelink siguen requiriendo Cloud porque regeneran `devices-cache.json` desde la cuenta eWelink.

### Refresco manual

Para forzar una recarga de la tabla ARP eWelink desde un cliente MQTT:

```bash
mosquitto_pub -h localhost -t luces/_bridge/refresh -m arp
```

Payloads aceptados:

| Payload | Acción |
|---------|--------|
| `arp` | Recarga la tabla ARP eWelink y recalcula disponibilidad |
| `ewelink` | Alias de `arp` |
| `tuya` | Redescubre IPs Tuya por UDP, actualiza disponibilidad y persiste IPs nuevas en `tuya-devices.json` |
| `all` | Ejecuta refresco eWelink/ARP y redescubrimiento Tuya |

El bridge responde en `luces/_bridge/refresh/status` con un JSON como:

```json
{
  "status": "ok",
  "command": "all",
  "ts": "2026-06-03T12:00:00.000Z",
  "ewelink": {
    "success": true,
    "arpEntries": 12,
    "devices": 4,
    "online": 3,
    "offline": 1
  },
  "tuya": {
    "success": true,
    "devices": 3,
    "online": 3,
    "offline": 0,
    "physicalDevices": 1
  }
}
```

### Tópicos nativos de Tasmota (internos)

El manager también escucha los tópicos propios de Tasmota para obtener datos ricos:

| Tópico | Descripción |
|--------|-------------|
| `tasmota/discovery/+/config` | Discovery nativo: nombre, IP, MAC, modelo, firmware |
| `tele/+/LWT` | Disponibilidad (Online / Offline) |
| `stat/+/POWER` | Cambios de estado en tiempo real |
| `tele/+/STATE` | Telemetría periódica con estado de carga |

> **Nota:** Para que el tópico `tasmota/discovery/+/config` sea publicado por el dispositivo,
> asegúrate de que la opción **SetOption19** esté activa en tu Tasmota, o usa el comando
> `Discover 1` desde la consola del dispositivo.

## 📦 Estructura del Proyecto

```
ewelink-knil/
├── src/
│   ├── mqtt-bridge.js          ← Entry point principal
│   └── managers/
│       ├── ewelink-manager.js  ← Control eWelink (LAN + Cloud)
│       ├── tuya-manager.js     ← Control local Tuya
│       └── tasmota-manager.js  ← Descubrimiento y control Tasmota
├── scripts/
│   ├── create-cache.js         ← Genera/refresca devices-cache.json y arp-table.json
│   ├── tasmota-control.js      ← Prueba manual de control Tasmota
│   └── tasmota-discovery.js    ← Descubrimiento interactivo de Tasmota
├── archive/                    ← Código legacy (no se ejecuta)
├── tuya-devices.json           ← Config Tuya (excluido de git)
├── devices-cache.json          ← Caché eWelink (excluido de git, auto-generado)
├── arp-table.json              ← Tabla ARP local (excluido de git, auto-generado)
├── ecosystem.config.cjs        ← Configuración PM2
└── package.json
```

## 🔧 Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Inicia el bridge con nodemon (recarga en cambios) |
| `npm run start` | Inicia el bridge directamente con Node |
| `npm run cache` | Regenera la caché de dispositivos eWelink y la tabla ARP |
| `npm run tasmota` | Prueba control manual de un dispositivo Tasmota |
| `npm run tasmota:discovery` | Modo interactivo de descubrimiento Tasmota |

## 🤝 Dependencias

| Paquete | Uso |
|---------|-----|
| [`@pipechela/ewelink-api`](https://www.npmjs.com/package/@pipechela/ewelink-api) | Cliente eWelink (LAN + Cloud) |
| [`mqtt`](https://www.npmjs.com/package/mqtt) | Cliente MQTT para Node.js |
| [`tuyapi`](https://www.npmjs.com/package/tuyapi) | Control local de dispositivos Tuya |
| [`dotenv`](https://www.npmjs.com/package/dotenv) | Variables de entorno |
| [`@supabase/supabase-js`](https://www.npmjs.com/package/@supabase/supabase-js) | Cliente Supabase (lecturas de sensores) |

## 📝 Licencia
ISC
