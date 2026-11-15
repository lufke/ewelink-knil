const registered = document.querySelector('#devices');
const discovered = document.querySelector('#discovered');
const message = document.querySelector('#message');
const discoverButton = document.querySelector('#discover');
const addDialog = document.querySelector('#add-dialog');
const addForm = document.querySelector('#add-form');
const addName = document.querySelector('#add-name');
const addDeviceDetails = document.querySelector('#add-dialog-device');
const confirmAdd = document.querySelector('#confirm-add');
let pendingDevice = null;
let renamingDevice = false;

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Error en la solicitud.');
  return result;
}

function empty(container, text) {
  const note = document.createElement('p');
  note.className = 'empty';
  note.textContent = text;
  container.append(note);
}

document.querySelector('#cancel-add').addEventListener('click', () => addDialog.close());
addForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = addName.value.trim();
  addName.setCustomValidity(name ? '' : 'Escribe un nombre para el dispositivo.');
  if (!pendingDevice || !addForm.reportValidity()) return;
  confirmAdd.disabled = true;
  try {
    if (renamingDevice) {
      await request(`/api/devices/${encodeURIComponent(pendingDevice.id)}`, {
        method: 'PATCH', body: JSON.stringify({ source: 'cozylife', name })
      });
    } else {
      await request('/api/devices', {
        method: 'POST', body: JSON.stringify({ source: 'cozylife', id: pendingDevice.id, name })
      });
    }
    addDialog.close();
    message.textContent = renamingDevice
      ? `Nombre del dispositivo actualizado a ${name}.`
      : `${name} agregado al inventario.`;
    pendingDevice = null;
    renamingDevice = false;
    await load();
  } catch (error) {
    message.textContent = error.message;
  } finally { confirmAdd.disabled = false; }
});

function openNameDialog(device, isRename = false) {
  pendingDevice = device;
  renamingDevice = isRename;
  document.querySelector('#add-dialog-title').textContent = isRename
    ? 'Cambiar nombre del dispositivo'
    : 'Agregar dispositivo CozyLife';
  confirmAdd.textContent = isRename ? 'Guardar nombre' : 'Agregar';
  addDeviceDetails.textContent = `ID: ${device.id}${device.ip ? ` · IP: ${device.ip}` : ''}`;
  addName.value = device.nombre || device.id;
  addName.setCustomValidity('');
  addDialog.showModal();
  addName.focus();
  addName.select();
}

function setPowerIcon(button, state) {
  button.replaceChildren();
  button.classList.remove('is-on', 'is-off', 'is-unknown');
  button.classList.add(`is-${state}`);
  if (state === 'unknown') {
    const unknown = document.createElement('span');
    unknown.className = 'unknown-icon';
    unknown.textContent = '?';
    unknown.setAttribute('aria-hidden', 'true');
    button.append(unknown);
    button.setAttribute('aria-label', 'Estado indeterminado. Pulsa para encender');
    button.title = 'Estado indeterminado · Pulsa para encender';
    return;
  }

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const bulb = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  bulb.setAttribute('d', 'M9 18h6m-5 3h4m-2-19a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2.3h6c0-1.1.4-1.8 1-2.3A7 7 0 0 0 12 2Z');
  bulb.setAttribute('stroke', 'currentColor');
  bulb.setAttribute('stroke-width', '1.8');
  bulb.setAttribute('stroke-linecap', 'round');
  bulb.setAttribute('stroke-linejoin', 'round');
  if (state === 'on') bulb.setAttribute('fill', 'currentColor');
  icon.append(bulb);
  button.append(icon);
  const action = state === 'on' ? 'apagar' : 'encender';
  button.setAttribute('aria-label', `Ampolleta ${state === 'on' ? 'encendida' : 'apagada'}. Pulsa para ${action}`);
  button.title = `Pulsa para ${action}`;
}

function makeCard(device, isDiscovered = false) {
  const card = document.createElement('article');
  const heading = document.createElement('div');
  heading.className = 'card-head';
  const title = document.createElement('h3');
  title.textContent = device.nombre || device.id;
  heading.append(title);
  if (!isDiscovered) {
    const badge = document.createElement('span');
    badge.className = `badge ${device.online ? 'online' : ''}`;
    badge.textContent = device.online ? 'online' : 'offline';
    heading.append(badge);
  }
  const details = document.createElement('p');
  details.className = 'details';
  details.textContent = [
    device.source || 'CozyLife',
    device.id,
    device.ip || 'IP desconocida',
    isDiscovered ? `PID ${device.pid || 'desconocido'} · RSSI ${device.rssi ?? '?'}` : `Estado: ${device.estado || 'unknown'}`
  ].join(' · ');
  const actions = document.createElement('div');
  actions.className = 'actions';
  if (isDiscovered) {
    const add = document.createElement('button');
    add.textContent = device.configured ? 'Ya registrado' : 'Agregar';
    add.disabled = Boolean(device.configured);
    add.addEventListener('click', async () => {
      openNameDialog(device);
    });
    actions.append(add);
  } else {
    const currentState = ['on', 'off'].includes(String(device.estado).toLowerCase())
      ? String(device.estado).toLowerCase()
      : 'unknown';
    const button = document.createElement('button');
    button.className = 'power-toggle';
    setPowerIcon(button, currentState);
    button.addEventListener('click', async () => {
      const targetState = currentState === 'on' ? 'off' : 'on';
      button.disabled = true;
      try {
        await request(`/api/devices/${encodeURIComponent(device.id)}/set`, {
          method: 'POST', body: JSON.stringify({ source: device.source, state: targetState })
        });
        message.textContent = `Comando ${targetState === 'on' ? 'encender' : 'apagar'} enviado a ${device.nombre}.`;
        await new Promise(resolve => setTimeout(resolve, 800));
        await load();
      } catch (error) {
        message.textContent = error.message;
        button.disabled = false;
      }
    });
    actions.append(button);
    if (device.source === 'cozylife') {
      const rename = document.createElement('button');
      rename.className = 'secondary';
      rename.textContent = 'Cambiar nombre';
      rename.addEventListener('click', () => openNameDialog(device, true));
      actions.append(rename);

      const remove = document.createElement('button');
      remove.className = 'danger';
      remove.textContent = 'Quitar';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`¿Quitar ${device.nombre} del inventario local?`)) return;
        try {
          await request(`/api/devices/${encodeURIComponent(device.id)}?source=cozylife`, { method: 'DELETE' });
          message.textContent = `${device.nombre} quitado del inventario local.`;
          await load();
        } catch (error) { message.textContent = error.message; }
      });
      actions.append(remove);
    }
  }
  card.append(heading, details, actions);
  return card;
}

async function load() {
  try {
    const [{ devices }, found] = await Promise.all([
      request('/api/devices'),
      request('/api/discovery')
    ]);
    registered.replaceChildren();
    discovered.replaceChildren();
    if (!devices.length) empty(registered, 'No hay dispositivos registrados.');
    else devices.forEach(device => registered.append(makeCard(device)));
    if (!found.devices.length) empty(discovered, 'Usa “Buscar CozyLife” para iniciar un descubrimiento.');
    else found.devices.forEach(device => discovered.append(makeCard(device, true)));
  } catch (error) { message.textContent = error.message; }
}

discoverButton.addEventListener('click', async () => {
  discoverButton.disabled = true;
  message.textContent = 'Enviando broadcast CozyLife y escuchando respuestas…';
  try {
    await request('/api/discovery', { method: 'POST', body: '{}' });
    await new Promise(resolve => setTimeout(resolve, 2500));
    await load();
    message.textContent = 'Descubrimiento CozyLife actualizado.';
  } catch (error) { message.textContent = error.message; }
  finally { discoverButton.disabled = false; }
});

document.querySelector('#refresh').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await request('/api/refresh', { method: 'POST', body: JSON.stringify({ source: 'all' }) });
    await load();
    message.textContent = 'Refresco solicitado.';
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
});

load();
setInterval(load, 5000);
