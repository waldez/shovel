'use strict';

const http = require('http');
const ShovelClient = require('./client');

const request = (processResponse, { method = 'POST', port, host, path = '/', bodyParser }, data) => {

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

module.exports = ShovelClient.create.bind(null, request);
