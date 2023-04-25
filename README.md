# Elasticmaps

[![Build Status](https://github.com/inaturalist/elasticmaps/workflows/elasticmaps%20CI/badge.svg)](https://github.com/inaturalist/elasticmaps/actions)
[![Coverage Status](https://coveralls.io/repos/inaturalist/elasticmaps/badge.svg?branch=main)](https://coveralls.io/r/inaturalist/elasticmaps?branch=main)

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
// is running on http://localhost:9200, and that there is an index
// named elasticmaps_development which has documents with minimally
// an integer `id` and geo_point `location` field

const Elasticmaps = require( "elasticmaps" );
const port = Number( process.env.PORT || 4000 );

const app = Elasticmaps.server( );
// create the tile route
app.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", Elasticmaps.route );

app.listen( port, ( ) => {
  console.log( "Listening on " + port );
} );
```

----

```js
// In this example a custom config object is supplied
// when creating the server. Functions can be provided
// to create custom queries and styles based on the request

const Elasticmaps = require( "elasticmaps" );
const port = Number( process.env.PORT || 4000 );

const config =  {
  environment: "production",
  debug: true,
  tileSize: 256,
  elasticsearch: {
    host: "http://localhost:9200",
    searchIndex: "points_index",
    geoPointField: "location"
  },
  prepareQuery: req => {
    req.elastic_query = ...;
  },
  prepareStyle: req => {
    req.style = ...;
  }
};

const server = Elasticmaps.server( config );
server.listen( port, ( ) => {
  console.log( "Listening on " + port );
} );
```
