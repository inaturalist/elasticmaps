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

ElasticMapper.csvFromGeohash = function( req, geohashAggregation ) {
  // sorting by count looked weird
  var sorted = _.sortBy( geohashAggregation.buckets,
    function( hit ) {
      if( hit.geohash ) {
        return hit.geohash.hits.hits[0].sort[0];
      }
      return null;
    }
  );
  var csvData = [ ];
  sorted.forEach( function( hit ) {
    var fieldData = hit.geohash.hits.hits[0]._source;
    var coords = fieldData.location.split( "," );
    var data = _.map( _.without( req.elastic_query.fields, "location" ), function( f ) {
      return _.reduce( f.split( "." ), function( memo, num ) {
        if( _.isUndefined( memo ) ) {
          return null;
        }
        return memo[ num ];
      }, fieldData );
    }).concat( coords[0], coords[1] );
    csvData.push( data.join( "," ) );
  });
  return csvData;
};

ElasticMapper.csvFromPoints = function( req, hits ) {
  var csvData = [ ];
  hits.forEach( function( hit ) {
    var coords = hit.fields.location[0].split( "," );
    var data = _.map( _.without( req.elastic_query.fields, "location" ), function( f ) {
      return hit.fields[ f ];
    }).concat( coords[0], coords[1] );
    csvData.push( data.join( "," ) );
  });
  return csvData;
};

ElasticMapper.route = function( req, res ) {
  req.startTime = Date.now( );
  req.params.zoom = parseInt( req.params.zoom );
  req.params.x = parseInt( req.params.x );
  req.params.y = parseInt( req.params.y );
  if( req.params.zoom < 1 || req.params.zoom > 21 ) {
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
  var map, layer, bbox = null;
  Step(
    function( ) {
      global.config.prepareQuery( req, this );
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      global.config.prepareStyle( req, this );
    },
    function( err, req ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      MapGenerator.createMapTemplate( req, this );
    },
    function( err, req, m, l, b ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      map = m;
      layer = l;
      bbox = b;
      req.elastic_query.query.filtered.filter.push(
        ElasticRequest.boundingBoxFilter( bbox ) );
      ElasticRequest.search( req.elastic_query, this );
    },
    function( err, result ) {
      if( err ) { return ElasticMapper.renderError( res, err ); }
      ElasticMapper.debug( result.took + "ms / " + result.hits.total + " results :: [" + bbox + "]" );
      var csvData = [ ];
      if( result.aggregations && result.aggregations.zoom1 ) {
        csvData = ElasticMapper.csvFromGeohash( req, result.aggregations.zoom1 );
      } else if( result.hits ) {
        csvData = ElasticMapper.csvFromPoints( req, result.hits.hits );
      }
      res.setHeader( "Cache-Control", "public, max-age=7200" );
      MapGenerator.finishMap( req, res, map, layer, csvData, this );
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
