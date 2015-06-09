var express = require( "express" ),
    querystring = require( "querystring" ),
    Step = require( "step" ),
    _ = require( "underscore" ),
    MapGenerator = require( "./map_generator" ),
    ElasticRequest = require( "./elastic_request" ),
    ElasticMapper = { };

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

ElasticMapper.prepareStyle = function( req, callback ) {
  callback( null, req );
};

ElasticMapper.prepareQuery = function( req, callback ) {
  req.elastic_query = { };
  req.elastic_query.sort = { "id" : "desc" };
  req.elastic_query.fields = ElasticRequest.defaultMapFields( );
  req.elastic_query.query = ElasticRequest.defaultMapFilters( );
  switch( req.params.style ) {
    case "points":
      req.elastic_query.size = 20000;
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
  var target;
  if( result.aggregations && result.aggregations.zoom1 ) {
    target = _.sortBy( result.aggregations.zoom1.buckets,
      function( hit ) {
        if( hit.geohash ) {
          return hit.geohash.hits.hits[0].sort[0];
        }
        return null;
      }
    );
  } else if( result.hits ) {
    target = result.hits.hits;
  } else { return [ ]; }
  var fields_to_map = _.without( req.elastic_query.fields, "location" );
  var csvData = _.map( target, function( hit ) {
    var fieldData;
    if( hit.geohash ) { fieldData = hit.geohash.hits.hits[0].fields; }
    else { fieldData = hit.fields; }
    var hash = _.object(
      _.map( fields_to_map, function( f ) {
        var value = fieldData[ f ] ? fieldData[ f ][ 0 ] : null;
        if( value === "F" ) { value = false; }
        if( value === "T" ) { value = false; }
        return [ f, value ];
      }));
    if( _.isObject( fieldData.location[0] )) {
      hash.latitude = fieldData.location[ 0 ].lat;
      hash.longitude = fieldData.location[ 0 ].lon;
    } else {
      var coords = fieldData.location[0].split( "," );
      hash.latitude = coords[ 0 ];
      hash.longitude = coords[ 1 ];
    }
    return hash;
  });
  return csvData;
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
      global.config.prepareQuery( req, this );
    },
    function( err, req, m, l, b ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      MapGenerator.createMercator( );
      req.bbox = MapGenerator.merc.convert( MapGenerator.bboxFromParams( req ) );
      req.elastic_query.query.filtered.filter.push(
        ElasticRequest.boundingBoxFilter( req.bbox ) );
      ElasticRequest.search( req.elastic_query, this );
    },
    function( err, result ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      ElasticMapper.debug( result.took + "ms / " + result.hits.total + " results :: [" + req.bbox + "]" );
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
      res.setHeader( "Cache-Control", "public, max-age=1" );
      MapGenerator.finishMap( req, res, m, l, req.csvData, this );
    },
    function( err, req, res ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      req.endTime = new Date( );
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
  global.config.elasticsearch = _.defaults( global.config.elasticsearch || { }, {
    host: "localhost:9200",
    searchIndex: "elasticmaps_" + global.config.environment,
    geoPointField: "location"
  });
  // set default functions
  global.config.prepareQuery = global.config.prepareQuery || ElasticMapper.prepareQuery;
  global.config.prepareStyle = global.config.prepareStyle || ElasticMapper.prepareStyle;
  // create the server and the map route
  var server = express( );
  server.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", ElasticMapper.route )
  return server;
};

module.exports = ElasticMapper;
