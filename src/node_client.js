'use strict';

const http = require('http');
const ShovelClient = require('./client');

// for now, sessionId is generated once, at the time, module is loaded to the memmory
const sessionId = ShovelClient.generateSessionId();
const getSessionId = () => sessionId;

const request = (processResponse, { method = 'POST', port, host, path = '/', bodyParser }, data, headers) => {

    let req;
    let promise = new Promise((resolve, reject) => {

        data = typeof data === 'object' ? JSON.stringify(data) : data;
        req = http.request({ method, path, host, port, headers }, res => {
            // Continuously update stream with data
            let body = '';
            res.on('data', d => { body += d; });
            res.on('end', () => { processResponse(resolve, reject, body, res.statusCode, res.statusMessage, bodyParser); });
        });

        req.on('error', error => {

            reject(error);
        });

        // write data to request body
        if (data) {
            req.write(data);
        }
    });

    // enhance promise with request cancelation
    promise.abort = () => {

        promise.aborted = true;
        req.abort.bind(req);
        return promise;
    };

    // send the data
    req.end();
    // return enhanced promise
    return promise;
};

module.exports = ShovelClient.create.bind(null, request, getSessionId);
