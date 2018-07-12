'use strict'
/**
 * @fileOverview SHOVEL: Shit Happens Online Via Epic Library
 * @author waldez
 * ▛▀▀▌▟█▖▛▀▀▌
 * ▌█▌▌▟▝▖▌█▌▌
 * ▌▀▘▌▄▙▖▌▀▘▌
 * ▀▀▀▘▘▌▘▀▀▀▘
 * ▛▀▌▀█▞▝▐▟▝▖
 * ▐▞▘▜▛ ▜ ▟▞
 * ▘▀▝▀█▝▚▌▄▐▖
 * ▛▀▀▌▀▐▙▗▟▛
 * ▌█▌▌▛▟▚▚▌▄
 * ▌▀▘▌▌▟▙▝▟▌
 * ▀▀▀▘▀▘▘▀▝▝
 */

const fs = require('fs');
const EventEmitter = require('events');
const pathUtil = require('path');
// Generate a v1 UUID (time-based)
const uuidV1 = require('uuid/v1');
// Generate a v4 UUID (random)
const uuidV4 = require('uuid/v4');

const farmhash = require('farmhash');
const Promise = require('bluebird');
const Server = require('./server');
const Wrapper = require('./wrapper');
const ScopeContainer = require('./scope_container');
const Session = require('./session');
const JSONE = require('./jsone');

const DEFAULT_PORT = 31415;

const PERSISTENCE = Object.freeze({
    Server: 0,           // lives 'till unregistered on server side
    Client: 1,           // lives 'till unregistered on client side (or local storage cleaned)
    Session: 2,          // lives 'till in session storage
    Temporary: 3         // lives 'till sent
});

const SCOPE = Object.freeze({
    GLOBAL: 0,
    SESSION: 1
});

function analyzeInstance(instance) {

    let protoType = Object.getPrototypeOf(instance);
    let protoHash = farmhash.fingerprint32(protoType.constructor.toString());
    let uid = farmhash.fingerprint32(uuidV1());

    return {
        protoType,
        protoHash,
        typeName: protoType.constructor.name || `unnamed${protoHash}`,
        uid
    };
}

function* joinWrappersScopes(global, session) {

    yield* global.wrappers.entries();

    if (session) {
        yield* session.data.wrappers.entries();
    }
}

function mapToJson(map) {

    // const json = Object.create(null);
    const json = {};
    for (const [key, value] of map.entries()) {
        json[key] = value;
    }
    return json;
}

function jsonToMap(json) {

    const map = new Map();
    for (const key in json) {
        if (!json.hasOwnProperty || json.hasOwnProperty(key)) {
            map.set(key, json[key]);
        }
    }
    return map;
}

class Metadata {

    constructor(data) {

        this.data = data;
    }
}

class FunctionHandler {

    constructor(id, callback) {

        Object.defineProperties(this, {
            id: {
                get: () => id
            },
            callback: {
                get: () => callback
            }
        });
    }
}

class Shovel extends EventEmitter {

    constructor(/*options*/{ port = DEFAULT_PORT } = {}) {

        super();
        // TODO: Map of registered prototypes to be able fast compare

        const jsonHandlers = {
            Wrapper: {
                name: 'Wrapper',
                ctor: Wrapper,
                stringify: (wrapper, session) => {

                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                },
                parse: ({ uid, typeHash }, session) => {

                    let wrapper = this.getWrapper(uid, session);
                    if (wrapper) {
                        return Wrapper.getInstance(wrapper);
                    }

                    throw new Error(`Parse error! Wrapper of type(hash) '${typeHash}' doesn't have instance uid '${'${uid}'}'`);
                    // TODO: better
                    return null;
                }
            },
            regInstances: {
                name: 'Wrapper',
                instanceOf: (instance, session) => this.hasInstance(instance, session),
                stringify: (instance, session) => {

                    const wrapper = this.getInstance(instance, session);
                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                }
            },
            metadata: {
                name: 'Metadata',
                ctor: Metadata,
                stringify: (instance, session) => {

                    return JSON.stringify(instance.data);
                }
            },
            tmpInstances: {
                name: 'Wrapper',
                instanceOf: (instance, session) => {

                    // test yet not registered class
                    if (!this.hasInstance(instance, session)) {
                        const proto = Object.getPrototypeOf(instance);
                        // discard plain Object derivates and also those with no protoype at all
                        if (proto !== Object.prototype && typeof proto != 'undefined') {
                            return true;
                        }
                    }

                    return false;
                },
                stringify: (instance, session) => {

                    const wrapper = this.register(instance, { session });
                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                }
            },
            FunctionHandler: {
                name: 'FunctionHandler',
                stringify: (instance, session) => `{"id":"${instance.id}}"`,
                parse: ({ id }, session) => {

                    let handler = session.getFnHandler(id);
                    if (!handler) {
                        handler = new FunctionHandler(id,
                            (...args) => this.server.sendHandlerRequest(session.id, this.jsone.encode({
                                    id,
                                    data: args
                                }, session)));
                        session.setFnHandler(handler);
                    }
                    // !! pridat handler do metadat oznaceny k odregistrovani na serveru
                    return handler.callback;
                }
            }
        };

        const sessionMap = new Map();

        this.sessionMap = sessionMap;
        this.jsone = new JSONE({ handlers: jsonHandlers });
        this.types = {}; // ??

        // string:uuid
        this.globWrappers = new Map();

        // global scope containing wrappers and instances
        this.globalData = new ScopeContainer();

        this.port = port;
        this.server = new Server(port, {
            Promise,
            incomingMessageHandler: this.processRequest.bind(this),
            clientSourcePromise: this.getClientSrc(),
            clientSourceMinPromise: this.getClientSrc(true),
            verbose: true
        });

        // start the fun!
        this.server.start();
    }

    getClientSrc(minified) {

        return new Promise((resolve, reject) => {

            fs.readFile(
                pathUtil.join(__dirname, `../dist/client_bundle${minified ? '.min' : ''}.js`),
                'utf8',
                (error, clientSrc) => error ? reject(error) : resolve(clientSrc));
        });
    }

    getServer() { return this.server.server; }

    stop(callback) {

        this.server.close(callback);
    }

    // helpers - TODO: make them private

    hasInstance(instance, session) {

        return session && session.data.hasInstance(instance) || this.globalData.hasInstance(instance);
    }

    getInstance(instance, session) {

        return session && session.data.getInstance(instance) || this.globalData.getInstance(instance);
    }

    getWrapper(uuid, session) {

        return session && session.data.getWrapper(uuid) || this.globalData.getWrapper(uuid);
    }

    setInstanceAndWrapper(uuid, instance, wrapper, session) {

        (session && session.data || this.globalData).setInstanceAndWrapper(uuid, instance, wrapper);
    }

    deleteInstanceAndWrapper(uuid, instance, session) {

        (session && session.data || this.globalData).deleteInstanceAndWrapper(uuid, instance);
    }

    dataUuidsEqual(globalDataUuid, dataUuid, session) {

        return (session && session.data.uuid == dataUuid || !session) && this.globalData.uuid == globalDataUuid;
    }

    /**
     * Registers item to Shovel
     * @param  {*} instance
     * @param  {{
     *         persistence: PERSISTENCE,
     *         scope: SCOPE,
     *         name: string
     * }} options
     * @return {Wrapper}
     */
    register(instance, options = {}) {

        const { name, persistence, /*scope,*/ session } = options;
        const scope = session ? SCOPE.SESSION : SCOPE.GLOBAL;

        let wrapper = this.getInstance(instance, session);
        if (!wrapper) {

            const {
                protoType,
                protoHash,
                typeName,
                uid
            } = analyzeInstance(instance);

            wrapper = new Wrapper(instance, { uid, proccessIherited: true });
            Wrapper.setMeta(wrapper, {
                typeHash: protoHash,
                typeName,
                // prototype of wrapped instances
                protoType,
                name
            });

            // check, if we can name global instance
            if (typeof name == 'string' && scope === SCOPE.GLOBAL) {
                if (this.globWrappers.has(name)) {
                    throw new Error(`Instance already registered with global name ${name}`);
                }

                this.globWrappers.set(name, uid);
            }

            this.setInstanceAndWrapper(uid, instance, wrapper, session);
        }

        return wrapper;
        // Q: need to do anything else?
    }

    /**
     * Let go of the wrapper
     * @param  {Wrapper|Object} obj
     */
    unregister(obj, session) {

        let instance = obj;
        let wrapper;

        if (obj instanceof Wrapper) {
            wrapper = obj;
            instance = wrapper[_instance];
        } else {
            wrapper = this.getInstances(instance, session);
        }

        if (wrapper) {
            let { name } = Wrapper.getMeta(wrapper);
            this.globWrappers.delete(name);
            this.deleteInstanceAndWrapper(Wrapper.getUID(wrapper), instance, session);
        }
    }

    getWrapperByPath(path, session) {

        const uid = typeof path == 'number' ? path : this.globWrappers.get(path);
        return this.getWrapper(uid, session);
    }

    buildMetadata(session, generateNew) {

        return new Metadata({
                    dataUuid: session.data.uuid,
                    globalDataUuid: this.globalData.uuid,
                    globals: generateNew ? mapToJson(this.globWrappers) : {},
                    metadata: generateNew ? this.listRegistered(session) : {}
                });
    }

    listRegistered(session) {

        let result = {};
        for (let [uid, wrapper] of joinWrappersScopes(this.globalData, session)) {
            let {
                /*name,
                scope,*/
                typeHash,
                typeName
            } = Wrapper.getMeta(wrapper);

            let wrapperClass = result[typeHash] || {
                typeName,
                descriptor: Wrapper.getDescriptor(wrapper),
                instances: []
            };

            wrapperClass.instances.push(uid);
            result[typeHash] = wrapperClass;
        }

        return result;
    }

    buildResult(path, session, clientMetadata, data) {

        // first of all, encode data, during encoding could be new (in session scope)
        // wrappers been registered, so, after that, we compare data uuids, so we will know
        // if client needs new metadata to be generated
        const encodedData = this.jsone.encode({ [path]: { data } }, session);
        // now create metadata
        const encodedMetadata = this.jsone.encode(
            this.buildMetadata(session, !this.dataUuidsEqual(
                clientMetadata.globalDataUuid,
                clientMetadata.dataUuid,
                session)));

        // stick them together as JSON string (two item array [metadata, data])
        return '[' + encodedMetadata + ',' + encodedData + ']';
    }

    processRawData(rawData, sessionId) {

        const session = this.getSessionData(sessionId);
        const [metadata = {}, requestData = {}] = this.jsone.decode(rawData, session);

        return {
            metadata,
            requestData,
            session
        };
    };


    getSessionData(sessionId = null) {
        let session = this.sessionMap.get(sessionId);

        if (!session) {
            session = new Session(sessionId);
            this.sessionMap.set(sessionId, session);
            this.emit('newSession', sessionId, session);
        }

        return session;
    }

    sendMessage(data, sessionId) {

        const session = this.getSessionData(sessionId);
        return this.server.sendMessage(this.jsone.encode(data, session), sessionId);
    }

    async processRequest(rawData, sessionId, requestId) {

        let {
            metadata,
            requestData,
            session
        } = this.processRawData(rawData, sessionId);

        let { action, path = 0, field, data } = requestData;

        if (!action) { // in future, in this case, we want to send some info data, or whatever
            throw new Error('Malformed request!');
        }

        // wrapper independent requests
        if (action == 'list') {
            return this.buildResult('Ξ', session, metadata, null);
        }

        // wrapper dependent requests
        let wrapper = this.getWrapperByPath(path, session);
        if (!wrapper) {
            throw new Error(`No wrapper at path '${path}'!`);
        }

        // check the field
        if (!wrapper.hasOwnProperty(field)) {
            throw new Error(`No such field '${field}' on wrapper '${path}'!`);
        }

        // TODO: refactor to function map
        if (action == 'get') {
            return this.buildResult(path, session, metadata, wrapper[field]);
        }

        if (action == 'set') {
            return this.buildResult(path, session, metadata, wrapper[field] = data);
        }

        if (action == 'call') {
            if (typeof wrapper[field] != 'function') {
                throw new Error(`No such function '${field}' on wrapper '${path}'!`);
            }

            const callResult = await wrapper[field].apply(wrapper, data);
            return this.buildResult(path, session, metadata, callResult);
        }

        return {
            message: 'Hello Shovel!',
            originalRequest: JSON.stringify(requestData)
        };
    }
}

module.exports = {
    Shovel,
    ShovelClient: require('./node_client'),
    SCOPE,
    PERSISTENCE
};
