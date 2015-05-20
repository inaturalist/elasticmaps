Elasticmaps
=========

[![Build Status](https://travis-ci.org/inaturalist/elasticmaps.svg?branch=master)](https://travis-ci.org/inaturalist/elasticmaps)

A Node.js map tile server based on node-mapnik and elasticsearch

Installation
-------
```
npm install elasticmaps --save
```

Usage
-----
```
// This is the most basic example. It assumes elasticsearch
// is running on localhost:9200, and that there is an index
// named elasticmaps_production which has documents with minimally
// an integer `id` and geo_point `location` field

var server = require( "elasticmaps" ).
      server( { environment: "test", debug: true }),
    port = Number( process.env.PORT || 4000 );

server.listen( port, function( ) {
  console.log( "Listening on " + port );
});
```
