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
    },

    // production - babel + UglifyJS
    module: {
        rules: [
        {
            test: /\.js$/,
            exclude: [/node_modules/],
            use: [{
                loader: 'babel-loader',
                options: { presets: ['es2015'] }
            }]
        }
          // Loaders for other file types can go here
        ]
    },
    plugins: [
        new webpack.LoaderOptionsPlugin({
            minimize: true,
            debug: false
        }),
        new webpack.optimize.UglifyJsPlugin({
            beautify: false,
            mangle: {
                'screw_ie8': true,
                'keep_fnames': true
            },
            compress: {
                'screw_ie8': true
            },
            comments: false
        })
    ]

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
