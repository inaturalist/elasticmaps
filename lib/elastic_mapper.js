"use strict";
var express = require( "express" ),
    querystring = require( "querystring" ),
    Step = require( "step" ),
    _ = require( "lodash" ),
    crypto = require( "crypto" ),
    path = require( "path" ),
    fs = require( "fs" ),
    del = require( "del" ),
    MapGenerator = require( "./map_generator" ),
    ElasticRequest = require( "./elastic_request" ),
    ElasticMapper = { },
    value = null;

ElasticMapper.renderMessage = function( res, message, status ) {
  res.set( "Content-Type", "text/html" );
  res.status( status ).send( message ).end( );
};

ElasticMapper.renderError = function( res, error ) {
  ElasticMapper.debug( error );
  if( error.message && error.status ) {
    ElasticMapper.renderMessage( res, error.message, error.status );
  } else {
    ElasticMapper.renderMessage( res, "Error", 500 );
  }
};

ElasticMapper.requestPassthrough = function( req, callback ) {
  callback( null, req );
};

ElasticMapper.requestResultPassthrough = function( req, res, callback ) {
  callback( null, req, res );
};

ElasticMapper.prepareQuery = function( req, callback ) {
  req.elastic_query = { };
  req.elastic_query.sort = { "id" : "desc" };
  req.query.source = { includes: ElasticRequest.defaultMapFields( ) };
  req.elastic_query.query = { bool: { } };
  switch( req.params.style ) {
    case "points":
      req.elastic_query.size = 10000;
      break;
    case "geohash":
      req.elastic_query.size = 0;
      req.elastic_query.aggregations = ElasticRequest.geohashAggregation( req );
      break;
    default:
      return callback( { message: "unknown style: " +
        req.params.style, status: 404 }, req );
  }
  callback( null, req );
};

ElasticMapper.csvFromResult = function( req, result ) {
  if( req.params.dataType === "geojson" ) {
    return ElasticMapper.polygonCSVFromResult( req, result );
  }
  var target;
  if( result.aggregations && result.aggregations.zoom1 ) {
    target = _.sortBy( result.aggregations.zoom1.buckets,
      function( hit ) {
        if( hit.geohash ) {
          return hit.geohash.hits.hits[ 0 ].sort[ 0 ];
        }
        return null;
      }
    );
  } else if( result.hits ) {
    target = result.hits.hits;
  } else { return [ ]; }
  var geoPointField = global.config.elasticsearch.geoPointField;
  var fields_to_map = _.without( req.query.source.includes || [], geoPointField );
  fields_to_map.push( "cellCount" );
  var csvData = _.map( target, function( hit ) {
    var fieldData = hit._source || hit.geohash.hits.hits[0]._source;
    fieldData.private_location = !_.isEmpty(fieldData.private_location);
    if( !hit._source && hit.geohash ) {
      fieldData.cellCount = hit.geohash.hits.total;
    }
    let hash = { };
    _.each( fields_to_map, f => {
      if( f.match( /\./ ) ) {
        var parts = f.split('.');
        if( fieldData[ parts[0] ] && fieldData[ parts[0] ][ parts[1] ] ) {
          value = fieldData[ parts[0] ][ parts[1] ];
        } else {
          value = null;
        }
      } else {
        value = fieldData[ f ] ? fieldData[ f ] : null;
      }
      if( value === "F" ) { value = false; }
      if( value === "T" ) { value = true; }
      hash[f] = value;
    });
    if( _.isObject( fieldData[ geoPointField ] )) {
      hash.latitude = fieldData[ geoPointField ].lat;
      hash.longitude = fieldData[ geoPointField ].lon;
    } else {
      var coords = fieldData[ geoPointField ].split( "," );
      hash.latitude = Number( coords[0] );
      hash.longitude = Number( coords[1] );
    }
    return hash;
  });
  return csvData;
};

ElasticMapper.polygonCSVFromResult = function( req, result ) {
  return _.map( result.hits.hits, function( hit ) {
    return { id: hit._source.id, geojson: hit._source.geometry_geojson };
  });
};

ElasticMapper.cacheKeyForReq = function( req ) {
  const query = _.cloneDeep( req.query );
  delete query.source;
  delete query.color;
  delete query.width;
  delete query.callback;
  const sorted = _( query ).toPairs( ).sortBy( 0 ).fromPairs( ).value( );
  const cryptKey = crypto.
    createHash( "md5" ).
    update( JSON.stringify( sorted ), "utf8" ).
    digest( "hex" );
  return cryptKey;
};

ElasticMapper.fetchEntireGeohashGrid = function( req ) {
  if ( !req.queryCacheDir || !req.precisionCacheDir ) {
    return;
  }
  MapGenerator.createMercator( );
  // create the cache dir for the query
  if ( !fs.existsSync( req.queryCacheDir ) ) {
    fs.mkdirSync( req.queryCacheDir );
  }
  // create the cache dir for this zoom level of the query
  del.sync([req.precisionCacheDir]);
  fs.mkdirSync( req.precisionCacheDir );
  fs.appendFileSync( `${req.precisionCacheDir}/processing.lock`, "\n" );

  console.log("Starting query cache");
  const queryCopy = _.cloneDeep( req.elastic_query );
  queryCopy.aggregations = {
    zoom1: {
      geohash_grid: {
        field: global.config.elasticsearch.geoPointField,
        precision: ElasticRequest.geohashPrecision( req.params.zoom ),
        size: 300000
      },
      aggs: {
        geohash: {
          top_hits: {
            sort: { id: { order: "desc" } },
            _source: (( req.query && req.query.source ) ?
              req.query.source : false ),
            size: 1
          }
        }
      }
    }
  };
  const startTime = new Date( ).getTime( );
  ElasticRequest.search( { elastic_query: queryCopy }, ( err, r ) => {
    const endTime = new Date( ).getTime( );
    console.log( ["cache query duration", `took ${endTime - startTime}ms`] );
    if ( err ) { return; }
    console.log([ "cache bucket count", r.aggregations.zoom1.buckets.length ]);
    const data = ElasticMapper.csvFromResult( req, r );

    const tilestartTime = new Date( ).getTime( );
    console.log("saving tile caches");
    _.each( data, d => {
      const xyz = MapGenerator.merc.xyz([d.longitude,d.latitude,d.longitude,d.latitude], req.params.zoom);
      fs.appendFileSync( `${req.precisionCacheDir}/${xyz.minX}.${xyz.minY}.data`, JSON.stringify( d ) + "\n" );
      const cellbbox = MapGenerator.merc.convert( MapGenerator.bboxFromParams( { params: {
        zoom: req.params.zoom,
        x: xyz.minX,
        y: xyz.minY
      } } ) );
      const diffLng = ( cellbbox[2] - cellbbox[0] ) * 0.1;
      const diffLat = ( cellbbox[3] - cellbbox[1] ) * 0.1;
      if ( d.latitude < cellbbox[1] + diffLat ) {
        fs.appendFileSync( `${req.precisionCacheDir}/${xyz.minX}.${xyz.minY+1}.data`, JSON.stringify( d ) + "\n" );
      }
      if ( d.latitude > cellbbox[3] - diffLat ) {
        fs.appendFileSync( `${req.precisionCacheDir}/${xyz.minX}.${xyz.minY-1}.data`, JSON.stringify( d ) + "\n" );
      }
      if ( d.longitude > cellbbox[2] - diffLng ) {
        fs.appendFileSync( `${req.precisionCacheDir}/${xyz.minX+1}.${xyz.minY}.data`, JSON.stringify( d ) + "\n" );
      }
      if ( d.longitude < cellbbox[0] + diffLng ) {
        fs.appendFileSync( `${req.precisionCacheDir}/${xyz.minX-1}.${xyz.minY}.data`, JSON.stringify( d ) + "\n" );
      }
    });
    const tileendTime = new Date( ).getTime( );
    console.log( ["done caching", `took ${tileendTime - tilestartTime}ms`] );
    fs.unlinkSync( `${req.precisionCacheDir}/processing.lock`, "\n" );
  });
}

ElasticMapper.route = function( req, res ) {
  req.startTime = Date.now( );
  req.params.zoom = parseInt( req.params.zoom );
  req.params.x = parseInt( req.params.x );
  req.params.y = parseInt( req.params.y );
  let cachedData;
  if( req.params.zoom < 0 || req.params.zoom > 21 ) {
    return ElasticMapper.renderMessage( res, "Invalid zoom", 404 );
  }
  var zoomDimension = Math.pow( 2, req.params.zoom );
  if( req.params.x < 0 || req.params.x >= zoomDimension ) {
    return ElasticMapper.renderMessage( res, "Invalid x value", 404 );
  }
  if( req.params.y < 0 || req.params.y >= zoomDimension ) {
    return ElasticMapper.renderMessage( res, "Invalid y value", 404 );
  }
  if( !_.includes( [ "png", "grid.json", "torque.json" ], req.params.format ) ) {
    return ElasticMapper.renderMessage( res, "Invalid format", 404 );
  }
  Step(
    function( ) {
      global.config.beforePrepareQuery( req, this );
    },
    function( err ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      global.config.prepareQuery( req, this );
    },
    function( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      const cryptoKey = "tile-" + ElasticMapper.cacheKeyForReq( req );
      const precision = ElasticRequest.geohashPrecision( req.params.zoom );
      if ( !req.query.cache && precision >= 7 || !global.config || !global.config.tilesCacheDir ) {
        return( null, null );
      }
      req.queryCacheDir = `${global.config.tilesCacheDir}/${cryptoKey}`;
      req.precisionCacheDir = `${req.queryCacheDir}/${req.params.zoom}`
      if ( !fs.existsSync( req.precisionCacheDir ) ) {
        ElasticMapper.fetchEntireGeohashGrid( req, () => {} );
      }
      return ( null, null );
    },
    function( err, cached ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      if ( req.query.cache && fs.existsSync( req.precisionCacheDir ) &&
           !fs.existsSync(  `${req.precisionCacheDir}/processing.lock` ) ) {
        const cellFile = `${req.precisionCacheDir}/${req.params.x}.${req.params.y}.data`;
        if ( fs.existsSync( cellFile ) ) {
          cachedData = fs.readFileSync( cellFile ).toString( ).trim( ).split( "\n" ).map( i => JSON.parse( i ) );
        } else {
          // empty array to indicate the data was cached, but empty
          cachedData = [ ];
        }
        return this( null, req );
      }
      this( null, req );
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      if( cachedData || req.params.dataType === "postgis" ) { return this( null, null ); }
      ElasticRequest.applyBoundingBoxFilter( req );
      ElasticRequest.search( req, this );
    },
    function( err, result ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      if( cachedData || req.params.dataType === "postgis" ) { return this( null, req ); }
      if( req.params.format === "torque.json" ) {
        MapGenerator.torqueJson( result, req, res );
        return;
      }

      ElasticMapper.debug( result.took +
        "ms / " + result.hits.total + " results :: [" + req.bbox + "]" );
      req.csvData = ElasticMapper.csvFromResult( req, result );
      return( null, req );
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      if( req.params.format === "grid.json" ) { return( null, req ); }
      else {
        global.config.prepareStyle( req, this );
      }
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      MapGenerator.createMapTemplate( req, this );
    },
    function( err, req, m, l ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      MapGenerator.finishMap( req, res, m, l, req.csvData || cachedData, this );
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      global.config.beforeSendResult( req, res, this );
    },
    function( err, req, res ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      req.endTime = new Date( );
      if( req.params.format === "grid.json" ) {
        res.jsonp( req.tileData );
      } else {
        res.writeHead( 200, { "Content-Type": "image/png" });
        res.end( req.tileData );
      }
      if( global.config.debug ) {
        ElasticMapper.printRequestLog( req );
      }
    }
  );
};

ElasticMapper.printRequestLog = function( req ) {
  var logText = "[ "+ new Date( ).toString( ) + "] GET /"+ req.params.style +
    "/"+ req.params.zoom +"/"+ req.params.x +
    "/"+ req.params.y +"."+ req.params.format;
  if( !_.isEmpty( req.query ) ) {
    logText += "?" + querystring.stringify( req.query );
  }
  logText += " " + ( req.endTime - req.startTime ) + "ms";
  ElasticMapper.debug( logText );
}

ElasticMapper.debug = function( text ) {
  if( global.config.debug ) {
    console.log( text );
  }
};

ElasticMapper.server = function( config ) {
  config = config || { };
  global.config = _.defaults( config, {
    environment: config.NODE_ENV || process.env.NODE_ENV || "development",
    tileSize: 256,
    debug: ( config.debug === false ) ? false : true
  });
  global.config.log = global.config.log ||
    "elasticmaps."+ global.config.environment +".log";
  global.config.elasticsearch = _.defaults(
    global.config.elasticsearch || { },
    {
      host: "localhost:9200",
      searchIndex: "elasticmaps_" + global.config.environment,
      geoPointField: "location"
    }
  );
  // set default functions
  global.config.beforePrepareQuery =
    global.config.beforePrepareQuery || ElasticMapper.requestPassthrough;
  global.config.prepareQuery =
    global.config.prepareQuery || ElasticMapper.prepareQuery;
  global.config.prepareStyle =
    global.config.prepareStyle || ElasticMapper.requestPassthrough;
  global.config.beforeSendResult =
    global.config.beforeSendResult || ElasticMapper.requestResultPassthrough;
  // create the server and the map route
  var server = express( );
  if( global.config.prepareApp && _.isFunction( global.config.prepareApp ) ) {
    global.config.prepareApp( server, config );
  }
  return server;
};

module.exports = ElasticMapper;
