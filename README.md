Elasticmaps
=========

[![npm version](https://badge.fury.io/js/elasticmaps.svg)](http://badge.fury.io/js/elasticmaps) [![Build Status](https://travis-ci.org/inaturalist/elasticmaps.svg?branch=master)](https://travis-ci.org/inaturalist/elasticmaps) [![Coverage Status](https://coveralls.io/repos/inaturalist/elasticmaps/badge.svg?branch=master)](https://coveralls.io/r/inaturalist/elasticmaps?branch=master)

A Node.js map tile server based on node-mapnik and elasticsearch

Installation
-------
```
npm install elasticmaps --save
```

Usage
-----
```js
// This is the most basic example. It assumes elasticsearch
// is running on localhost:9200, and that there is an index
// named elasticmaps_development which has documents with minimally
// an integer `id` and geo_point `location` field

var server = require( "elasticmaps" ).server( ),
    port = Number( process.env.PORT || 4000 );

server.listen( port, function( ) {
  console.log( "Listening on " + port );
});
```

----

```js
// In this example a custom config object is supplied
// when creating the server. Functions can be provided
// to create custom queries and styles based on the request

var Elasticmaps = require( "elasticmaps" ),
    port = Number( process.env.PORT || 4000 );

var config =  {
  environment: "production",
  debug: true,
  tileSize: 256,
  elasticsearch: {
    host: "localhost:9200",
    searchIndex: "points_index",
    geoPointField: "location"
  },
  prepareQuery: function( req, callback ) {
    req.elastic_query = ...;
    callback( null, req );
  },
  prepareStyle: function( req, callback ) {
    req.style = ...;
    callback( null, req );
  }
};

var server = Elasticmaps.server( config );
server.listen( port, function( ) {
  console.log( "Listening on " + port );
});
```
