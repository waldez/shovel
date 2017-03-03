'use strict';
// ES6 compliant - 'cause of Promise

// module closure, independent of environment
(({ exportModule, importModule, request }) => {

    const JSONE = importModule('jsone');

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

    // reveal the module to it's natural habitat
    exportModule(ShovelClient.create.bind(null, request));
})((() => {
    // check environment voodoo
    try {
        var isNode = !!(module && module.exports);
    } catch (e) {
        isNode = !window;
    }

    let exportModule;
    let importModule;
    let request;
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

    if (isNode) {
        exportModule = mod => module.exports = mod;
        importModule = modName => require('./' + modName);

        let http = require('http');

        request = ({ method = 'POST', port, host, path = '/', bodyParser }, data) => {

            return new Promise((resolve, reject) => {

                data = typeof data === 'object' ? JSON.stringify(data) : data;
                let req = http.request({ method, path, host, port }, res => {
                    // Continuously update stream with data
                    let body = '';
                    res.on('data', d => { body += d; });
                    res.on('end', () => { processResponse(resolve, reject, body, res.statusCode, res.statusMessage, bodyParser); });
                });

                req.on('error', (e) => {
                    // TODO: better!
                    console.log(`problem with request: ${e}`);
                });

                // write data to request body
                if (data) {
                    req.write(data);
                }
                req.end();
            });
        };

    } else {
        exportModule = mod => window.ShovelClient = mod;
        importModule = modName => window[modName];

        request = ({ method = 'POST', port, host, path = '/', bodyParser }, data) => {

            return new Promise((resolve, reject) => {

                data = typeof data === 'object' ? JSON.stringify(data) : data;
                let req = new XMLHttpRequest();

                // TODO: do the headers
                // req.setRequestHeader('custom-header', 'value');

                req.onreadystatechange = () => {

                    if (req.readyState === XMLHttpRequest.DONE) {
                        processResponse(resolve, reject, req.responseText, req.status, /*req.statusMessage*/ undefined, bodyParser);
                    }
                };
                req.open(method, `http://${host}:${port}${path}`, true);
                req.send(data);
            });
        };
    }

    return {
        // session Id - par of client identifier (in browser, store to session storage)
        exportModule,
        importModule,
        request
    };
})());
