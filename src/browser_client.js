'use strict';

const ShovelClient = require('./client');
const request = (processResponse, { method = 'POST', port, host, path = '/', bodyParser }, data) => {

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

module.exports = ShovelClient.create.bind(null, request);
