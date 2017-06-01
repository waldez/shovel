'use strict'

// Generate a v1 UUID (time-based)
const uuidV1 = require('uuid/v1');

class ScopeContainer {

    constructor() {
        // uuid:wrapper
        const wrappers = new Map();
        // key: registered instance, value: { Wrapper, type }
        const instances = new WeakMap();

        let dataUuid = uuidV1();

        Object.defineProperties(this, {
            uuid: {
                get: function() { return dataUuid; }
            },
            wrappers: {
                get: function() { return wrappers; }
            },
            instances: {
                get: function() { return instances; }
            }
        });

        this.hasInstance = function(instance) {

            return instances.has(instance);
        };

        this.getInstance = function(instance) {

            return instances.get(instance);
        };

        this.getWrapper = function(uuid) {

            return wrappers.get(uuid);
        };

        this.setInstanceAndWrapper = function(uuid, instance, wrapper) {

            dataUuid = uuidV1();

            instances.set(instance, wrapper);
            wrappers.set(uuid, wrapper);
        };

        this.deleteInstanceAndWrapper = function(uuid, instance) {

            if (instances.delete(instance) && wrappers.delete(uuid)) {
                // make it bultshit-proof, if nothig removed, no need for uuid regeneration
                dataUuid = uuidV1();
            }
        };
    }
}

module.exports = ScopeContainer;
