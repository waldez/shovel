#!/usr/bin/env node
'use strict'

const webpack = require('webpack');
const path = require('path');
const webPackConfig = {
    context: path.resolve(__dirname, '../src'),
    entry: {
        app: './browser_client.js'
    },
    output: {
        path: path.resolve(__dirname, '../dist'),
        filename: 'client_bundle.js',
        library: 'ShovelClient'
    }
};

webpack(webPackConfig).run((err, stats) => {

    if (err) {
        console.log('ERROR:', err);
    }

    console.log(stats.toString({
        // Add console colors
        colors: true
    }));
});
