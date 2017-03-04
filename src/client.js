'use strict';
const JSONE = require('./jsone');

const UID_KEY = Symbol('uid');
const TYPE_KEY = Symbol('type');
const Ξ = Symbol('private');

const ACTIONS = {
    list: 'list',
    call: 'call',
    get: 'get',
    set: 'set'
};

const url = '/';

const OK_STATUSES = [200];
const DEFAULT_BODY_PARSER = JSON.parse.bind(JSON);

let isOkStatus = status => OK_STATUSES.indexOf(status) > -1;
let processResponse = (resolve, reject, body, statusCode, statusMessage, bodyParser = DEFAULT_BODY_PARSER) => {

    let response = body;

    if (isOkStatus(statusCode)) {
        try {
            Promise.resolve(bodyParser(body))
                .then(resolve)
                .catch(reject);
        } catch (parsingError) {
            Promise.reject(parsingError);
        }

    } else {
        let errorResponse = {
            statusCode,
            statusMessage,
            response
        };
        reject(errorResponse);
    }
};

let Wrapper = function(typeName, typeHash) {

    Object.defineProperties(this, {
        [TYPE_KEY]: {
            get: () => ({ typeName, typeHash })
        }
    });
};

function _w(instance) {

    if (instance instanceof Wrapper) {
        return instance;
    }

    throw Error('Not a Wrapper instance');
}

// some statics
Wrapper.isWrapper = function(instance) { return instance instanceof Wrapper; };
Wrapper.getTypeInfo = function(instance) { return _w(instance)[TYPE_KEY]; };
Wrapper.getUid = function(instance) { return _w(instance)[UID_KEY]; };
Wrapper.equals = function(a, b) { return _w(a)[UID_KEY] == _w(b)[UID_KEY]; };
Wrapper.stringify = function(instance) {

    let wrapper = _w(instance);
    return `{"uid":${wrapper[UID_KEY]},"typeHash":${wrapper[TYPE_KEY].typeHash}}`;
};

function createWrapperClass(descriptor, typeName, typeHash, shovel) {

    function getProperty(ctx, name) { return shovel(ctx[UID_KEY], ACTIONS.get, name); };
    function setProperty(ctx, name, value) { return shovel(ctx[UID_KEY], ACTIONS.set, name, value); };
    function callFunction(ctx, name, ...args) { return shovel(ctx[UID_KEY], ACTIONS.call, name, args); }

    // this cheap trick is for the name of the constructor function
    const wrapperClassName = typeName + 'Wrapper';
    let dummy = {
        [wrapperClassName]: function(uid) { this[UID_KEY] = uid; }
    };

    let classConstructor = dummy[wrapperClassName];

    let proto = new Wrapper(typeName, typeHash);

    for (var key in descriptor) {
        let { type, parameters } = descriptor[key];

        if (type == 'function') {
            let joinedPars = parameters.join();
            let pars = joinedPars.length != '' ? ',' + joinedPars : '';
            let body = `(function(${joinedPars}) { return callFunction(this,'${key}'${pars}); })`;
            // new Function() doesn't create closure
            let fn = eval(body);
            proto[`${key}`] = fn;
        } else {
            proto[`${key}`] = function(value) { return typeof value == 'undefined' ? getProperty(this, key) : setProperty(this, key, value); };
        }
    }

    classConstructor.prototype = proto;
    classConstructor.prototype.constructor = classConstructor;
    return classConstructor;
}

class ShovelClient {
    constructor({ serviceHost = 'localhost', servicePort = '31415', request }) {

        request = request.bind(null, processResponse);
        // clientId, <-client identifier

        let that = this;
        // typeHash:[WrapperClass].constructor
        let wrappers = new Map();
        // uid:[WrapperClass]
        let instances = new Map();
        let boundShovel = this.shovel.bind(this);

        // handlers for unknown types (Wrapper type)
        let jsonHandlers = {
            Wrapper: {
                name: 'Wrapper',
                ctor: Wrapper,
                stringify: Wrapper.stringify,
                parse: ({ uid, typeHash }) => {

                    let instance = instances.get(uid);
                    if (instance) {
                        return instance;
                    }

                    let wrapperClass = wrappers.get(typeHash);
                    if (wrapperClass) {
                        return this[Ξ].addInstance(uid, wrapperClass.wrapper);
                    }

                    // TODO: better
                    return null;
                }
            }
        };

        // private stuff
        this[Ξ] = {
            JSONE: new JSONE({ handlers: jsonHandlers }),
            wrappers,
            instances,
            addWrapperClass: function(descriptor, typeName, typeHash) {

                let wrapper = wrappers.get(typeHash);
                if (!wrapper) {
                    wrapper = createWrapperClass(descriptor, typeName, typeHash, boundShovel);
                    wrappers.set(typeHash, {
                        wrapper,
                        descriptor,
                        typeName
                    });
                }
                return wrapper;
            }.bind(that),
            getWrapperClass: function(typeHash) { return wrappers.get(typeHash); }.bind(that),
            addInstance: function(uid, WrapperClass) {

                let instance = instances.get(uid);
                if (!instance) {
                    instance = new WrapperClass(uid);
                    instances.set(uid, instance);
                }
                return instance;
            }.bind(that)
        };

        this.getServiceInfo = () => ({ serviceHost, servicePort });
        this.request = function(serviceHost, servicePort, options = {}, data) {

            options.host = serviceHost;
            options.port = servicePort;

            return request(options, data);
        }.bind(this, serviceHost, servicePort);
    }

    initialize() {

        return this.list(true).then(() => this);
    }

    get(uid) {

        return this[Ξ].instances.get(uid);
    }

    list(forceRequest = false) {

        if (forceRequest) {
            let postData = { action: ACTIONS.list };

            return this.request({ method: 'POST', path: url }, postData)
                .then(data => {

                    let list = [];
                    for (let typeHash in data) {
                        let { descriptor, typeName, instances } = data[typeHash];
                        let WrapperClass = this[Ξ].addWrapperClass(descriptor, typeName, Number(typeHash));

                        instances.forEach(uid => {

                            this[Ξ].addInstance(uid, WrapperClass);
                        });

                        list.push({ typeName, instances });
                    }

                    return list;
                });
        } else {
            let types = new Map();
            this[Ξ].instances.forEach((instance, uid) => {

                let { typeName, typeHash } = instance[TYPE_KEY];
                let typeInfo = types.get(typeHash) || {
                    typeName,
                    instances: []
                };

                typeInfo.instances.push(uid);
                types.set(typeHash, typeInfo);

            });

            return Array.from(types.values());
        }
    }

    /**
     * shovels the data to server, process response and returns appropriate response
     * @param  {string} uid
     * @param  {string} action
     * @param  {string} name
     * @param  {Array<string>} args
     * @return {Promise}
     */
    shovel(uid, action, name, args) {

        const jsone = this[Ξ].JSONE;
        // TODO: encode args(data) to store types etc..
        const bodyParser = jsone.decode.bind(jsone);

        let postData = {
            action,
            path: uid,
            field: name,
            data: args
            // TODO: in the future, generate UUID for the request
        };

        return this.request({ method: 'POST', path: url, bodyParser }, jsone.encode(postData))
            .then(([metadata, data]) => {

                // TODO: decode data! and much more (like raise Shovel event, log etc)
                return data[uid].data;
            })
            .catch(error => {

                // TODO: log error, raise Shovel event etc..
                return Promise.reject(error);
            });
    }

    static get Wrapper() {

        return Wrapper;
    }

    static create(request, { serviceHost, servicePort } = {}, fetchList = true) {

        let client = new ShovelClient({ serviceHost, servicePort, request });
        return fetchList ? client.initialize() : client;
    }
}

module.exports = ShovelClient;
