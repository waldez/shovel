'use strict'
const Url = require('url');
const http = require('http');

const RESPONSE_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
};

class Server {

    constructor(port, router) {

        this.port = port;
        this.router = router;
        this.server = http.createServer(this.requestListener.bind(this));
    }

    start() {

        this.server.listen(this.port);
    }

    close(callback) {

        this.server.close(callback);
    }

    preprocessRequest(request) {

        let methodHandler = this.router[request.method];
        if (!methodHandler) {
            return { code: 400, error: `Method '${request.method}' not supported.` };
        }

        let url = Url.parse(request.url);
        let route = methodHandler[url.pathname];
        if (typeof route != 'function') {
            return { code: 400, error: `Endpoint '${url.pathname}' does not exist.` };
        }

        let query = url.query;
        let hash = url.hash;

        return {
            route,
            query,
            hash
        };
    }

    requestListener(req, res) {

        // preprocess request
        let prereq = this.preprocessRequest(req);

        if (prereq.error) { // do we want to continue?

            res.writeHead(prereq.code, RESPONSE_HEADERS);
            res.end(JSON.stringify({ error: { message: prereq.error } }));
            return;
        }

        // lets assume all the requests will be JSON with optional base64 encoding
        let body = [];
        req.on('data', chunk => {

            body.push(chunk);
        }).on('end', () => {

            body = Buffer.concat(body).toString();
            // at this point, `body` has the entire request body stored in it as a string
            prereq.route(body)
                .then(responseData => {

                    responseData = typeof responseData == 'string' ? responseData : JSON.stringify(responseData);
                    res.writeHead(200, RESPONSE_HEADERS);
                    res.end(Buffer.from(responseData));
                })
                .catch(error => {

                    if (error instanceof Error) {
                        error = error.stack;
                    }

                    res.writeHead(500, RESPONSE_HEADERS); // ?? do I want 500 all the time?
                    res.end(Buffer.from(JSON.stringify(error)));
                });
        });
    };
}

module.exports = Server;
