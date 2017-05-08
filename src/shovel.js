'use strict'
/**
 * @fileOverview SHOVEL: Shit Happens Online - Library
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

const PERSISTENCE_ENUM = [
    'Server',           // lives 'till unregistered on server side
    'Client',           // lives 'till unregistered on client side (or local storage cleaned)
    'Session',          // lives 'till in session storage
    'Temporary'         // lives 'till sent
];

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
                instanceOf: instance => this.instances.has(instance),
                stringify: instance => {

                    const wrapper = this.instances.get(instance);
                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                }
            },
            Wrapper: {
                name: 'Wrapper',
                ctor: Wrapper,
                stringify: wrapper => {

                    const { typeHash, typeName } = Wrapper.getMeta(wrapper);
                    return `{"uid":${Wrapper.getUID(wrapper)},"typeHash":${typeHash}}`;
                },
                parse: ({ uid, typeHash }, session) => {

                    let wrapper = this.wrappers.get(uid);
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
                stringify: instance => `{"id":"${instance.id}}"`,
                parse: ({ id }, { session }) => {

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

    stop(callback) {

        this.server.close(callback);
    }

    register(instance, persistence) {

        let {
            protoType,
            protoHash,
            typeName,
            uid
        } = analyzeInstance(instance);

        let wrapper = this.instances.get(instance);
        if (!wrapper) {
            // let uid = farmhash.fingerprint32(uuidV1());
            wrapper = new Wrapper(instance, { uid, proccessIherited: true });

            Wrapper.setMeta(wrapper, {
                typeHash: protoHash,
                typeName,
                // prototype of wrapped instances
                protoType
            });

            this.instances.set(instance, wrapper);
            this.wrappers.set(uid, wrapper);
        }

        return wrapper;
        // Q: need to do anything else?
    }

    /**
     * Let go of the wrapper
     * @param  {Wrapper|Object} obj
     */
    unregister(obj) {

        let instance = obj;
        let wrapper;

        if (obj instanceof Wrapper) {
            wrapper = obj;
            instance = wrapper[_instance];
        } else {
            wrapper = instances.get(instance);
        }

        if (wrapper) {
            this.instances.delete(instance);
            this.wrappers.delete(Wrapper.getUID(wrapper));
        }
    }

    getWrapperByPath(path) {

        // TODO: return wrapper based on path
        // paths could be:
        // 'MyClass', '13546132' <- in the first case, there is only one instance of that class, so it will
        // return this instance wrapper, in the second case, it's hash to an actual wrapper
        let uid = path;
        return this.wrappers.get(uid);
    }

    listRegistered() {

        let result = {};
        this.wrappers.forEach((wrapper, uid) => {

            let { typeHash, typeName } = Wrapper.getMeta(wrapper);

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

    buildResult(path, data) {

        // TODO: wrapper(shovel) requests return array!!
        // [0] - will contain needed WrapperClasses (in future only those, who has been missing on client)
        // [1] - actual result
        // it's because of order of parsing at client
        // FIX this!

        // encode data to the extended JSON
        return this.jsone.encode([
            { metadata: 'comming soon!' },
            { [path]: { data } }
            ]);
    }

    getSessionData(sessionId) {
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

            // why?!?
            // if (session.foreverHook) {
            //     session.foreverHook.reject({ aborted: 'true' });
            // }

            session.setForeverHook(resolveEncoded, reject);
        });
    }

    processRequest(requestData, request) {

        const sessionId = request.headers['x-shovel-session'];
        requestData = this.jsone.decode(requestData, {
            session: this.getSessionData(sessionId)
        });

        let { action, path = 0, field, data } = requestData;

        if (!action) { // in future, in this case, we want to send some info data, or whatever
            return Promise.reject('Malformed request!');
        }

        // wrapper independent requests
        if (action == 'list') {
            return Promise.resolve(this.listRegistered());
        }

        // wrapper dependent requests
        let wrapper = this.getWrapperByPath(path);

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
                return Promise.resolve(this.buildResult(path, wrapper[field]));
            } catch (error) {
                return Promise.reject(error);
            }
        }

        if (action == 'set') {
            try {
                return Promise.resolve(this.buildResult(path, wrapper[field] = data));
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
                    .then(this.buildResult.bind(this, path));
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
