import dotenv from 'dotenv'
import { Telegraf, Input, Markup } from 'telegraf';
import ewelinkManager from './ewelink-manager.js';
import tasmotaManager from './tasmota-manager.js';
import ngrokManager from './ngrok-manager.js';
import tuyaManager from './tuya-manager.js';
import { createClient } from "@supabase/supabase-js";
import ws from 'ws';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_API_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: ws,
    }
}) : null;


console.log('⏳ Pasó 1: Iniciando EwelinkManager...');
const ewelinkResult = await ewelinkManager.init();
console.log(`✅ eWelink Manager reresultado: ${ewelinkResult}`);

console.log('⏳ Pasó 2: Iniciando TasmotaManager...');
const tasmotaResult = await tasmotaManager.init();
console.log(`✅ Tasmota Manager reresultado: ${tasmotaResult}`);

console.log('⏳ Pasó 3: Iniciando NgrokManager...');
const ngrokResult = await ngrokManager.init();
console.log(`✅ Ngrok Manager resultado: ${ngrokResult}`);

if (!process.env.BOT_TOKEN) {
    console.error('❌ ERROR: BOT_TOKEN no encontrado en el archivo .env');
    process.exit(1);
}

console.log('Creando instancia de Telegraf...');
const bot = new Telegraf(process.env.BOT_TOKEN.trim());

try {
    console.log('Verificando token con getMe()...');
    const boti = await bot.telegram.getMe();
    console.log(`✅ Token válido. Bot: @${boti.username} (ID: ${boti.id})`);
} catch (e) {
    console.error('❌ Error: Token de bot inválido o sin conexión:', e.message);
}

// Middleware de debug para ver todas las acciones
bot.use(async (ctx, next) => {
    const start = Date.now();
    try {
        await next();
        if (ctx.callbackQuery) {
            console.log(`[DEBUG] Click detectado: ${ctx.callbackQuery.data} (procesado en ${Date.now() - start}ms)`);
        }
    } catch (err) {
        console.error(`[INTERNAL ERROR] en middleware:`, err);
    }
});

bot.catch((err, ctx) => {
    console.error(`[TELEGRAF ERROR] en ${ctx.updateType}:`, err);
});

bot.help((ctx) => ctx.reply('Comandos disponibles:\n/luces - Listar equipos (eWelink + Tasmota)\n/clima - Última lectura DHT11\n/refresh - Actualizar cache de equipos\n/ping - Probar si el bot responde\n/quit - Salir del chat'));

bot.command('ping', (ctx) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Comando /ping recibido de ${ctx.from.first_name} (@${ctx.from.username})`);
    ctx.reply('¡Pong! 🏓 El bot está vivo y respondiendo.');
});

bot.command('clima', async (ctx) => {
    if (!supabase) return ctx.reply('⚠️ Supabase no está configurado en el archivo .env (faltan SUPABASE_URL o SUPABASE_API_KEY).');
    
    try {
        const { data, error } = await supabase
            .from('dht11')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error) {
            // Si el error es porque no hay filas, lo manejamos amablemente
            if (error.code === 'PGRST116') {
                return await ctx.reply('No se encontraron lecturas en la tabla dht11.');
            }
            throw error;
        }

        if (data) {
            // Ajustamos las variables por si los nombres de columna varían (temperatura vs temp)
            const temp = data.temperatura ?? data.temperature ?? data.temp ?? data.t ?? '?';
            const hum = data.humedad ?? data.humidity ?? data.hum ?? data.h ?? '?';
            const fecha = data.created_at ? new Date(data.created_at).toLocaleString('es-CL') : 'Reciente';
            const equipo = data.equipo ?? data.device ?? data.sensor ?? data.mac ?? data.nombre ?? data.id_equipo ?? 'Desconocido';

            await ctx.reply(`🌡️ *Última Lectura DHT11*\n\n📡 *Equipo:* ${equipo}\n🔸 *Temperatura:* ${temp}°C\n🔹 *Humedad:* ${hum}%\n🕒 *Fecha:* ${fecha}`, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        console.error('Error consultando Supabase:', e);
        ctx.reply('❌ Ocurrió un error al consultar la tabla dht11 en Supabase. Revisa los logs de la consola.');
    }
});

bot.command('test', (ctx) => {
    ctx.reply('Probando botones...', Markup.inlineKeyboard([
        Markup.button.callback('Presiona aquí', 'test_action')
    ]));
});

bot.action('test_action', async (ctx) => {
    console.log('[DEBUG] Botón de prueba (test_action) presionado');
    await ctx.answerCbQuery('¡El sistema de botones funciona! ✅');
    await ctx.reply('Sigo vivo y los botones funcionan.');
});

bot.command('quit', async (ctx) => {
    try {
        await ctx.telegram.leaveChat(ctx.chat.id);
    } catch (error) {
        console.error(error);
    }
});

bot.command('luces', async ctx => {
    try {
        const equiposEwelink = ewelinkManager.getEquipos();
        const equiposTasmota = tasmotaManager.getEquipos();
        const equiposTuya = tuyaManager.getEquipos();

        if (equiposEwelink.length === 0 && equiposTasmota.length === 0 && equiposTuya.length === 0) {
            return ctx.reply('No se detectan equipos. Usa /refresh para eWelink o espera a que Tasmota/Tuya se configuren.');
        }

        const buttons = [];

        // Agregar equipos eWelink
        equiposEwelink.forEach(e => {
            buttons.push([
                Markup.button.callback(`🏠 ${e.nombre} (ON)`, `ewelink:${e.id}:on`),
                Markup.button.callback(`OFF`, `ewelink:${e.id}:off`)
            ]);
        });

        // Agregar equipos Tasmota
        equiposTasmota.forEach(e => {
            let estadoIcon = '🔴'; // offline
            if (e.online) {
                estadoIcon = e.estado === 'ON' ? '🟡' : '⚫';
            }
            buttons.push([
                Markup.button.callback(`${estadoIcon} ${e.nombre} (ON)`, `tasmota:${e.topic}:on`),
                Markup.button.callback(`OFF`, `tasmota:${e.topic}:off`)
            ]);
        });

        // Agregar equipos Tuya
        equiposTuya.forEach(e => {
            const estadoIcon = e.estado === 'ON' ? '🟡' : '⚫';
            buttons.push([
                Markup.button.callback(`💡 [Tuya] ${e.nombre} (ON)`, `tuya:${e.id}:on`),
                Markup.button.callback(`OFF`, `tuya:${e.id}:off`)
            ]);
        });

        await ctx.reply('Selecciona una acción:', Markup.inlineKeyboard(buttons));

    } catch (e) {
        console.error('Error en comando /luces:', e);
        ctx.reply('Ocurrió un error al listar los equipos.');
    }
});

bot.command('refresh', async ctx => {
    ctx.reply('🔄 Actualizando cache eWelink y solicitando estado a Tasmota...');
    const result = await ewelinkManager.refreshCache();
    
    tasmotaManager.requestRefresh();

    const tasmotaCount = tasmotaManager.getEquipos().length;

    let msg = '';
    if (result.success) {
        msg += `✅ eWelink: Cache actualizado (${result.count} equipos).\n`;
    } else {
        msg += `❌ eWelink Error: ${result.error}\n`;
    }
    msg += `✅ Tasmota: ${tasmotaCount} equipos descubiertos dinámicamente.`;

    ctx.reply(msg);
});

// Acción para equipos eWelink
bot.action(/^ewelink:(.+):(\w+)$/, async (ctx) => {
    const deviceId = ctx.match[1];
    const state = ctx.match[2];
    console.log(`[EWELINK] Procesando: ${deviceId} -> ${state}`);

    const equipos = ewelinkManager.getEquipos();
    const equipo = equipos.find(d => d.id === deviceId);

    try {
        await ctx.answerCbQuery(`Enviando ${state.toUpperCase()} a ${equipo ? equipo.nombre : deviceId}...`);
        const status = await ewelinkManager.setPowerState(deviceId, state);

        if (status.status === 'ok' || status.state === state) {
            await ctx.reply(`✅ ${equipo ? equipo.nombre : deviceId} ahora está ${state.toUpperCase()}`);
        } else {
            await ctx.reply(`⚠️ Error eWelink: ${JSON.stringify(status)}`);
        }
    } catch (error) {
        console.error('Error en acción eWelink:', error);
        try {
            await ctx.answerCbQuery('Error en la conexión local').catch(() => { });
            await ctx.reply(`❌ Error de conexión local con eWelink: ${error.message}`);
        } catch (innerError) {
            console.error('Error al enviar respuesta de error eWelink:', innerError);
        }
    }
});

// Acción para equipos Tasmota
bot.action(/^tasmota:(.+):(\w+)$/, async (ctx) => {
    const topic = ctx.match[1];
    const state = ctx.match[2];
    console.log(`[TASMOTA] Procesando: ${topic} -> ${state}`);

    const equipos = tasmotaManager.getEquipos();
    const equipo = equipos.find(d => d.topic === topic);

    try {
        await ctx.answerCbQuery(`Enviando ${state.toUpperCase()} a Tasmota ${topic}...`);
        const status = await tasmotaManager.setPowerState(topic, state);

        if (status.status === 'ok') {
            await ctx.reply(`✅ Tasmota [${equipo ? equipo.nombre : topic}] ahora está ${state.toUpperCase()}`);
        } else {
            await ctx.reply(`⚠️ Error Tasmota: ${status.error}`);
        }
    } catch (error) {
        console.error('Error en acción Tasmota:', error);
        try {
            await ctx.answerCbQuery('Error en la conexión MQTT').catch(() => { });
            await ctx.reply(`❌ Error de conexión MQTT con Tasmota: ${error.message}`);
        } catch (innerError) {
            console.error('Error al enviar respuesta de error Tasmota:', innerError);
        }
    }
});

// Acción para equipos Tuya
bot.action(/^tuya:(.+):(\w+)$/, async (ctx) => {
    const deviceId = ctx.match[1];
    const state = ctx.match[2];
    console.log(`[TUYA] Procesando: ${deviceId} -> ${state}`);

    const equipos = tuyaManager.getEquipos();
    const equipo = equipos.find(d => d.id === deviceId);

    try {
        await ctx.answerCbQuery(`Enviando ${state.toUpperCase()} a ${equipo ? equipo.nombre : deviceId}...`);
        const status = await tuyaManager.setPowerState(deviceId, state);

        if (status.status === 'ok') {
            await ctx.reply(`✅ Tuya [${equipo ? equipo.nombre : deviceId}] ahora está ${state.toUpperCase()}`);
        } else {
            await ctx.reply(`⚠️ Error Tuya: ${status.error}`);
        }
    } catch (error) {
        console.error('Error en acción Tuya:', error);
        try {
            await ctx.answerCbQuery('Error en la conexión local').catch(() => { });
            await ctx.reply(`❌ Error de conexión local con Tuya: ${error.message}`);
        } catch (innerError) {
            console.error('Error al enviar respuesta de error Tuya:', innerError);
        }
    }
});

// Catch-all para cualquier otra callback query
bot.on('callback_query', async (ctx) => {
    console.log(`[WARNING] Callback query no capturada por acciones: ${ctx.callbackQuery.data}`);
    try {
        await ctx.answerCbQuery('Acción no reconocida o expirada. Intenta /ewelink de nuevo.').catch(() => { });
    } catch (e) {
        console.error('Error al responder callback query no capturada:', e);
    }
});

bot.launch()
    .then(() => {
        console.log('✅ Bot de Telegram iniciado correctamente y listo para recibir comandos');
    })
    .catch((err) => {
        console.error('❌ Error al iniciar el bot:', err);
    });

// Manejo suave de cierre
process.once('SIGINT', () => {
    console.log('Bot apagándose (SIGINT)...');
    try { bot.stop('SIGINT'); } catch (e) {}
});
process.once('SIGTERM', () => {
    console.log('Bot apagándose (SIGTERM)...');
    try { bot.stop('SIGTERM'); } catch (e) {}
});
