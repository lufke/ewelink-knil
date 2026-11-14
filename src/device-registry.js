const SOURCE_ORDER = ['ewelink', 'tuya', 'tasmota', 'cozylife'];

export class DeviceRegistry {
    constructor(managers = {}) {
        this.managers = managers;
    }

    list() {
        return SOURCE_ORDER.flatMap(source => {
            const manager = this.managers[source];
            if (!manager?.getEquipos) return [];
            return manager.getEquipos().map(device => {
                const id = device.botId || device.id;
                return {
                    ...device,
                    id,
                    source: device.source || source,
                    nombre: device.nombre || device.name || id,
                    estado: String(device.estado || 'unknown').toLowerCase(),
                    online: Boolean(device.online),
                    managed: true
                };
            });
        });
    }

    getDiscovered() {
        return this.managers.cozylife?.getDiscovered?.() || [];
    }

    async discover() {
        const manager = this.managers.cozylife;
        if (!manager?.refreshDiscovery) throw new Error('El descubrimiento CozyLife no está disponible.');
        return manager.refreshDiscovery();
    }

    async add(source, id, name) {
        const manager = this.managers[source];
        if (!manager?.addDevice) throw new Error(`No se admite el alta administrada para ${source || 'ese fabricante'}.`);
        return manager.addDevice(id, name);
    }

    async remove(source, id) {
        const manager = this.managers[source];
        if (!manager?.removeDevice) throw new Error(`No se admite la baja administrada para ${source || 'ese fabricante'}.`);
        return manager.removeDevice(id);
    }

    async rename(source, id, name) {
        const manager = this.managers[source];
        if (!manager?.renameDevice) throw new Error(`No se admite cambiar el nombre para ${source || 'ese fabricante'}.`);
        return manager.renameDevice(id, name);
    }

    async setPowerState(source, id, state) {
        if (!['on', 'off'].includes(state)) throw new Error('El estado debe ser on u off.');
        const manager = this.managers[source];
        if (!manager?.setPowerState) throw new Error(`El manager ${source} no admite control.`);
        return manager.setPowerState(id, state);
    }

    async refresh(source = 'all') {
        if (source !== 'all' && !SOURCE_ORDER.includes(source) && source !== 'arp') {
            throw new Error(`Fabricante de refresco desconocido: ${source}`);
        }
        if (source === 'arp') source = 'ewelink';
        const sources = source === 'all' ? SOURCE_ORDER : [source];
        const results = {};
        for (const name of sources) {
            const manager = this.managers[name];
            if (manager?.refreshDiscovery) results[name] = await manager.refreshDiscovery();
            else if (manager?.refreshArpAvailability) results[name] = await manager.refreshArpAvailability();
            else if (manager?.requestRefresh) {
                manager.requestRefresh();
                results[name] = { success: true, requested: true };
            }
        }
        return results;
    }
}
