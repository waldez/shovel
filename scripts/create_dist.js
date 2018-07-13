'use strict'

const webpack = require('webpack');
const path = require('path');

const webPackConfig = {
    context: path.resolve(__dirname, '../src'),
    entry: {
        app: './client.js'
    },
    output: {
        path: path.resolve(__dirname, '../dist'),
        filename: 'client_bundle.js',
        library: 'ShovelClient'
    }
};

const minifyWebPackConfig = {
    context: path.resolve(__dirname, '../src'),
    entry: {
        app: './client.js'
    },
    output: {
        path: path.resolve(__dirname, '../dist'),
        filename: 'client_bundle.min.js',
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
                options: { presets: ['env'] }
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

function showResults(err, stats) {

    if (err) {
        console.log('ERROR:', err);
    }

    console.log(stats.toString({
        // Add console colors
        colors: true
    }));
}

// TODO: not optimal, but sufficient for now..
[webPackConfig, minifyWebPackConfig].forEach(config => {

    console.log(`Webpack is building ${config.output.filename}:`);
    webpack(config).run(showResults);
});
