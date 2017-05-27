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

// Generate a v1 UUID (time-based)
const uuidV1 = require('uuid/v1');
// Generate a v4 UUID (random)
const uuidV4 = require('uuid/v4');

const farmhash = require('farmhash');
const Promise = require('bluebird');
const Server = require('./server');
const Wrapper = require('./wrapper');
const Session = require('./session');
const JSONE = require('./jsone');

const DEFAULT_PORT = 31415;

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

class Shovel {

    constructor(/*options*/{ port = DEFAULT_PORT } = {}) {

        // TODO: Map of registered prototypes to be able fast compare

        const jsonHandlers = {
            regInstances: {
                name: 'Wrapper',
                instanceOf: (instance, session) => this.hasInstance(instance, session),
                stringify: (instance, session) => {

                    const wrapper = this.getInstance(instance, session);
                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                }
            },
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
            FunctionHandler: {
                name: 'FunctionHandler',
                stringify: (instance, session) => `{"id":"${instance.id}}"`,
                parse: ({ id }, session) => {

                    let handler = session.getFnHandler(id);
                    if (!handler) {
                        handler = new FunctionHandler(id, (...args) => session.consumeHandlerResult(id, args));
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

        // string:wrappers
        this.globWrappers = new Map();

        // uuid:wrapper
        this.wrappers = new Map();

        // key: registered instance, value: { Wrapper, type }
        this.instances = new WeakMap();

        this.port = port;
        this.server = new Server(port, {
            // define routes
            'OPTIONS': (requestData, request) => Promise.resolve(200),
            'GET': {
                // not supported for now
            },
            'POST': {
                '/': this.processRequest.bind(this),
                '/foreverhook': this.processForeverHook.bind(this)
            }
        });

        this.server.on('requestaborted', request => {

            // be more clever... this is not nice solution
            if (request.url == '/foreverhook') {
                const sessionId = request.headers['x-shovel-session'];
                let session = this.getSessionData(sessionId);
                session.rejectForeverHook({ aborted: 'true' });
            }
        });

        this.server.start();
    }

    getServer() { return this.server.server; }

    stop(callback) {

        this.server.close(callback);
    }

    // helpers - TODO: make them private

    hasInstance(instance, session) {

        return (session && session.instances.has(instance)) || this.instances.has(instance);
    }

    getInstance(instance, session) {

        return (session && session.instances.get(instance)) || this.instances.get(instance);
    }

    setInstance(instance, wrapper, session) {

        return (session && session.instances.set(instance, wrapper)) || this.instances.set(instance, wrapper);
    }

    deleteInstance(instance, session) {

        return (session && session.instances.delete(instance)) || this.instances.delete(instance);
    }

    getWrapper(uuid, session) {

        return (session && session.wrappers.get(uuid)) || this.wrappers.get(uuid);
    }

    setWrapper(uuid, wrapper, session) {

        return (session && session.wrappers.set(uuid, wrapper)) || this.wrappers.set(uuid, wrapper);
    }

    deleteWrapper(uuid, session) {

        return (session && session.wrappers.delete(uuid)) || this.wrappers.delete(uuid);
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

        let { name, persistence, scope, session } = options;

        let {
            protoType,
            protoHash,
            typeName,
            uid
        } = analyzeInstance(instance);

        let wrapper = this.getInstance(instance, session);
        if (!wrapper) {

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

                this.globWrappers.set(name, wrapper);
            }
            this.setInstance(instance, wrapper, session);
            this.setWrapper(uid, wrapper, session);
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
            this.deleteInstance(instance, session);
            this.deleteWrapper(Wrapper.getUID(wrapper), session);
        }
    }

    getWrapperByPath(path, session) {

        // TODO: return wrapper based on path
        // paths could be:
        // 'MyClass', '13546132' <- in the first case, there is only one instance of that class, so it will
        // return this instance wrapper, in the second case, it's hash to an actual wrapper
        return typeof path == 'number' ? this.getWrapper(path, session) : this.globWrappers.get(path);
    }

    buildMetadata(session, known) {


    }

    listRegistered() {

        let result = {};
        this.wrappers.forEach((wrapper, uid) => {

            let { typeHash, typeName, name, scope } = Wrapper.getMeta(wrapper);

            let wrapperClass = result[typeHash] || {
                typeName,
                descriptor: Wrapper.getDescriptor(wrapper),
                instances: []
            };

            wrapperClass.instances.push(uid);
            result[typeHash] = wrapperClass;
        });

        return result;
    }

    buildResult(path, session, data) {

        // TODO: wrapper(shovel) requests return array!!
        // [0] - will contain needed WrapperClasses (in future only those, who has been missing on client)
        // [1] - actual result
        // it's because of order of parsing at client
        // FIX this!

        // encode data to the extended JSON
        return this.jsone.encode([
            { metadata: 'comming soon!' },
            { [path]: { data } }
            ], session);
    }

    getSessionData(sessionId = null) {
        let session = this.sessionMap.get(sessionId);

        if (!session) {
            session = new Session(sessionId);
            this.sessionMap.set(sessionId, session);
        }

        return session;
    }

    processForeverHook(requestData, request) {

        const sessionId = request.headers['x-shovel-session'];
        // do not need - for now!
        // requestData = this.jsone.decode(requestData);

        return new Promise((resolve, reject) => {

            let session = this.getSessionData(sessionId);
            let resolveEncoded = data => resolve(this.jsone.encode(data));

            // TODO:
            // FIX:
            // prosetrit! que?
            // why?!?
            if (session.foreverHook) {
                session.rejectForeverHook({ aborted: 'true' });
            }

            session.setForeverHook(resolveEncoded, reject);
        });
    }

    processRequest(requestData, request) {

        const sessionId = request.headers['x-shovel-session'];
        const session = this.getSessionData(sessionId);

        requestData = this.jsone.decode(requestData, session);

        let { action, path = 0, field, data } = requestData;

        if (!action) { // in future, in this case, we want to send some info data, or whatever
            return Promise.reject('Malformed request!');
        }

        // wrapper independent requests
        if (action == 'list') {
            return Promise.resolve(this.listRegistered());
        }

        // wrapper dependent requests
        let wrapper = this.getWrapperByPath(path, session);
        if (!wrapper) {
            return Promise.reject(`No wrapper at path '${path}'!`);
        }

        // check the field
        if (!wrapper.hasOwnProperty(field)) {
            return Promise.reject(`No such field '${field}' on wrapper '${path}'!`);
        }

        // TODO: refactor to function map
        if (action == 'get') {
            try {
                return Promise.resolve(this.buildResult(path, session, wrapper[field]));
            } catch (error) {
                return Promise.reject(error);
            }
        }

        if (action == 'set') {
            try {
                return Promise.resolve(this.buildResult(path, session, wrapper[field] = data));
            } catch (error) {
                return Promise.reject(error);
            }
        }

        if (action == 'call') {

            if (typeof wrapper[field] != 'function') {
                return Promise.reject(`No such function '${field}' on wrapper '${path}'!`);
            }

            try {
                return wrapper[field].apply(wrapper, data)
                    .then(this.buildResult.bind(this, path, session));
            } catch (error) {
                return Promise.reject(error);
            }
        }

        return Promise.resolve({
            message: 'Hello Shovel!',
            originalRequest: JSON.stringify(requestData)
        });
    }
}

module.exports = {
    Shovel,
    ShovelClient: require('./node_client')
};
