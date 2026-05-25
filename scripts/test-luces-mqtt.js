import mqtt from 'mqtt';

const broker = 'mqtt://knil.local:1883';
console.log(`Conectando a ${broker}...`);
const client = mqtt.connect(broker);

client.on('connect', () => {
  console.log('✅ Conectado al broker MQTT!');
  client.subscribe('luces/#', (err) => {
    if (err) {
      console.error('❌ Error al suscribirse:', err);
      process.exit(1);
    }
    console.log('📡 Suscrito a luces/#. Esperando mensajes por 5 segundos...');
  });
});

client.on('message', (topic, message) => {
  console.log(`Topic: ${topic}`);
  console.log(`Payload: ${message.toString()}`);
  console.log('-----------------------------------');
});

client.on('error', (err) => {
  console.error('❌ Error:', err);
});

setTimeout(() => {
  console.log('Terminando prueba.');
  client.end();
  process.exit(0);
}, 5000);
