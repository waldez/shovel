'use strict';

const ShovelClient = require('./client');

if (typeof window.sessionStorage != 'object') {
    throw new Error('Incompatible client for Shovel! Unsupported window.sessionStorage.');
}

const STORAGE_SESSION_KEY = 'shovelSessionId';

const getSessionId = () => {

    let sessionId = window.sessionStorage.getItem(STORAGE_SESSION_KEY);

    if (!sessionId) {
        sessionId = ShovelClient.generateSessionId();
        window.sessionStorage.setItem(STORAGE_SESSION_KEY, sessionId);
    }

    return sessionId;
};

const request = (processResponse, { method = 'POST', port, host, path = '/' }, data, headers) => {

    let req;
    let promise = new Promise((resolve, reject) => {

        data = typeof data === 'object' ? JSON.stringify(data) : data;
        req = new XMLHttpRequest();

        req.error = (error) => {

            reject({
                state: req.readyState,
                status: req.status,
                response: req.responseText,
                error
            });
        };

        req.onreadystatechange = () => {

            if (req.readyState === XMLHttpRequest.DONE) {
                processResponse(resolve, reject, req.responseText, req.status, /*req.statusMessage*/ undefined);
            }
        };
        req.open(method, `http://${host}:${port}${path}`, true);

        if (typeof headers == 'object') {
            for (let headerName in headers) {
                if (headers.hasOwnProperty(headerName)) {
                    req.setRequestHeader(headerName, headers[headerName]);
                }
            }
        }
    });

    // enhance promise with request cancelation
    promise.abort = () => {

        promise.aborted = true;
        req.abort();
        return promise;
    };

    // finally, send the stuff
    req.send(data);

    return promise;
};

module.exports = ShovelClient.create.bind(null, request, getSessionId);
