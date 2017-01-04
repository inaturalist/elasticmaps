var express = require( "express" ),
    querystring = require( "querystring" ),
    Step = require( "step" ),
    _ = require( "underscore" ),
    MapGenerator = require( "./map_generator" ),
    ElasticRequest = require( "./elastic_request" ),
    ElasticMapper = { }
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
  req.query.source = ElasticRequest.defaultMapFields( );
  req.elastic_query.query = ElasticRequest.defaultMapQuery( );
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
  var fields_to_map = _.without( req.query.source, geoPointField );
  var csvData = _.map( target, function( hit ) {
    var fieldData;
    if( hit.geohash ) {
      fieldData = hit.geohash.hits.hits[ 0 ]._source;
    }
    else { fieldData = hit._source; }
    var hash = _.object(
      _.map( fields_to_map, function( f ) {
        if( f.match( /\./ ) ) {
          parts = f.split('.');
          if( fieldData[ parts[0] ] && fieldData[ parts[0] ][ parts[1] ] ) {
            value = fieldData[ parts[0] ][ parts[1] ];
          } else {
            value = undefined;
          }
        } else {
          value = fieldData[ f ] ? fieldData[ f ] : null;
        }
        if( value === "F" ) { value = false; }
        if( value === "T" ) { value = true; }
        return [ f, value ];
      }));
    if( _.isObject( fieldData[ geoPointField ] )) {
      hash.latitude = fieldData[ geoPointField ].lat;
      hash.longitude = fieldData[ geoPointField ].lon;
    } else {
      var coords = fieldData[ geoPointField ].split( "," );
      hash.latitude = coords[ 0 ];
      hash.longitude = coords[ 1 ];
    }
    // add the source if it was requested
    if( hit.geohash && hit.geohash.hits.hits[0]._source ) {
      hash._source = hit.geohash.hits.hits[0]._source;
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

ElasticMapper.route = function( req, res ) {
  req.startTime = Date.now( );
  req.params.zoom = parseInt( req.params.zoom );
  req.params.x = parseInt( req.params.x );
  req.params.y = parseInt( req.params.y );
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
  if( !_.contains( [ "png", "grid.json" ], req.params.format ) ) {
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
    function( err, req, m, l, b ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      if( req.params.dataType === "postgis" ) { return this(null, null ); }
      ElasticRequest.applyBoundingBoxFilter( req );
      ElasticRequest.search( req, this );
    },
    function( err, result ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      if( req.params.dataType === "postgis" ) { return( null, req ); }
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
      MapGenerator.finishMap( req, res, m, l, req.csvData, this );
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
      var logText = "[ "+ new Date( ).toString( ) + "] GET /"+ req.params.style +
        "/"+ req.params.zoom +"/"+ req.params.x +
        "/"+ req.params.y +"."+ req.params.format;
      if( !_.isEmpty( req.query ) ) {
        logText += "?" + querystring.stringify( req.query );
      }
      logText += " " + ( req.endTime - req.startTime ) + "ms";
      ElasticMapper.debug( logText );
    }
  );
};

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
    global.config.prepareApp( server );
  }
  return server;
};

module.exports = ElasticMapper;
