/* eslint no-underscore-dangle: 0 */
/* eslint prefer-destructuring: 0 */
/* eslint no-console: 0 */

const express = require( "express" );
const querystring = require( "querystring" );
const Step = require( "step" );
const _ = require( "lodash" );
const Geohash = require( "latlon-geohash" );
const MapGenerator = require( "./map_generator" );
const ElasticRequest = require( "./elastic_request" );
const TileCache = require( "./tile_cache" );

const ElasticMapper = { };
let value = null;

ElasticMapper.renderMessage = ( res, message, status ) => {
  res.set( "Content-Type", "text/html" );
  res.status( status ).send( message ).end( );
};

ElasticMapper.renderError = ( res, error ) => {
  ElasticMapper.debug( error );
  if ( error.message && error.status ) {
    ElasticMapper.renderMessage( res, error.message, error.status );
  } else {
    ElasticMapper.renderMessage( res, "Error", 500 );
  }
};

ElasticMapper.requestPassthrough = ( req, callback ) => {
  callback( null, req );
};

ElasticMapper.requestResultPassthrough = ( req, res, callback ) => {
  callback( null, req, res );
};

ElasticMapper.prepareQuery = ( req, callback ) => {
  req.elastic_query = { };
  req.elastic_query.sort = { id: "desc" };
  req.query.source = { includes: ElasticRequest.defaultMapFields( ) };
  req.elastic_query.query = { bool: { } };
  switch ( req.params.style ) {
    case "points":
      req.elastic_query.size = 10000;
      break;
    case "geohash":
      req.elastic_query.size = 0;
      req.elastic_query.aggregations = ElasticRequest.geohashAggregation( req );
      break;
    default:
      return callback( {
        message: `unknown style: ${req.params.style}`,
        status: 404
      }, req );
  }
  return callback( null, req );
};

ElasticMapper.csvFromResult = ( req, result ) => {
  if ( req.params.dataType === "geojson" ) {
    return ElasticMapper.polygonCSVFromResult( req, result );
  }
  let target;
  if ( result.aggregations && result.aggregations.zoom1 ) {
    target = _.sortBy( result.aggregations.zoom1.buckets, hit => (
      hit.geohash ? hit.geohash.hits.hits[0].sort[0] : null
    ) );
  } else if ( result.hits ) {
    target = result.hits.hits;
  } else { return []; }
  const { geoPointField } = global.config.elasticsearch;
  const fieldsToMap = ( req.query.source && req.query.source.includes )
    ? _.without( req.query.source.includes, geoPointField )
    : [];
  fieldsToMap.push( "cellCount" );
  const csvData = _.map( target, hit => {
    if ( req.skipTopHits ) {
      const geohashLatLon = Geohash.decode( hit.key );
      return {
        cellCount: hit.doc_count,
        latitude: geohashLatLon.lat,
        longitude: geohashLatLon.lon
      };
    }
    const fieldData = hit._source || hit.geohash.hits.hits[0]._source;
    fieldData.private_location = !_.isEmpty( fieldData.private_location );
    if ( !hit._source && hit.geohash ) {
      fieldData.cellCount = hit.geohash.hits.total;
    }
    const properties = { };
    _.each( fieldsToMap, f => {
      if ( f.match( /\./ ) ) {
        const parts = f.split( "." );
        if ( fieldData[parts[0]] && fieldData[parts[0]][parts[1]] ) {
          value = fieldData[parts[0]][parts[1]];
        } else {
          value = null;
        }
      } else {
        value = fieldData[f] ? fieldData[f] : null;
      }
      if ( value === "F" ) { value = false; }
      if ( value === "T" ) { value = true; }
      properties[f] = value;
    } );
    let latitude;
    let longitude;
    if ( _.isObject( fieldData[geoPointField] ) ) {
      latitude = fieldData[geoPointField].lat;
      longitude = fieldData[geoPointField].lon;
    } else {
      const coords = fieldData[geoPointField].split( "," );
      latitude = Number( coords[0] );
      longitude = Number( coords[1] );
    }
    if ( req.params.format === "grid.json" ) {
      properties.latitude = latitude;
      properties.longitude = longitude;
    }
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude]
      },
      properties
    };
  } );
  return csvData;
};

ElasticMapper.polygonCSVFromResult = ( req, result ) => (
  _.map( result.hits.hits, hit => (
    { id: hit._source.id, geojson: hit._source.geometry_geojson }
  ) )
);

ElasticMapper.route = ( req, res ) => {
  req.startTime = Date.now( );
  req.params.zoom = parseInt( req.params.zoom, 10 );
  req.params.x = parseInt( req.params.x, 10 );
  req.params.y = parseInt( req.params.y, 10 );
  let cachedData;
  if ( req.params.zoom < 0 || req.params.zoom > 21 ) {
    return ElasticMapper.renderMessage( res, "Invalid zoom", 404 );
  }
  // eslint-disable-next-line no-restricted-properties
  const zoomDimension = Math.pow( 2, req.params.zoom );
  if ( req.params.x < 0 || req.params.x >= zoomDimension ) {
    return ElasticMapper.renderMessage( res, "Invalid x value", 404 );
  }
  if ( req.params.y < 0 || req.params.y >= zoomDimension ) {
    return ElasticMapper.renderMessage( res, "Invalid y value", 404 );
  }
  if ( !_.includes( ["png", "grid.json", "torque.json"], req.params.format ) ) {
    return ElasticMapper.renderMessage( res, "Invalid format", 404 );
  }
  Step(
    function ( ) {
      global.config.beforePrepareQuery( req, this );
    },
    function ( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      return global.config.prepareQuery( req, this );
    },
    function ( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      if ( req.params.format === "grid.json" ) { return ( null, req ); }
      return global.config.prepareStyle( req, this );
    },
    function ( err ) {
      if ( err ) { return void ElasticMapper.renderError( res, err ); }
      TileCache.cachedDataForRequest( req, ( errr, data ) => {
        if ( errr ) { return ElasticMapper.renderError( res, err ); }
        if ( data ) {
          cachedData = data;
          req.elasticmaps = req.elasticmaps || { };
          req.elasticmaps.cached = true;
        }
        return this( null, null );
      } );
    },
    function ( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      if ( cachedData || req.params.dataType === "postgis" ) { return this( null, null ); }
      ElasticRequest.applyBoundingBoxFilter( req );
      return ElasticRequest.search( req, { }, this );
    },
    function ( err, result ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      if ( cachedData || req.params.dataType === "postgis" ) { return this( null, req ); }
      if ( req.params.format === "torque.json" ) {
        return MapGenerator.torqueJson( result, req, res );
      }
      ElasticMapper.debug( `${result.took}ms / ${result.hits.total} results :: [${req.bbox}]` );
      req.csvData = ElasticMapper.csvFromResult( req, result );
      return ( null, req );
    },
    function ( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      return MapGenerator.createMapTemplate( req, this );
    },
    function ( err, rq, m, l ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      return MapGenerator.finishMap( req, res, m, l, req.csvData || cachedData, this );
    },
    function ( err ) {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      return global.config.beforeSendResult( req, res, this );
    },
    ( err, rq ) => {
      if ( err ) { return ElasticMapper.renderError( res, err ); }
      req.endTime = new Date( );
      if ( req.params.format === "grid.json" ) {
        res.jsonp( rq.tileData );
      } else {
        res.writeHead( 200, { "Content-Type": "image/png" } );
        res.end( rq.tileData );
      }
      if ( global.config.debug ) {
        ElasticMapper.printRequestLog( req );
      }
      return null;
    }
  );
  return null;
};

ElasticMapper.printRequestLog = req => {
  let logText = `[ ${new Date( ).toString( )}] GET /${req.params.style}`
    + `/${req.params.zoom}/${req.params.x}`
    + `/${req.params.y}.${req.params.format}`;
  if ( !_.isEmpty( req.query ) ) {
    logText += `?${querystring.stringify( req.query )}`;
  }
  logText += ` ${req.endTime - req.startTime}ms`;
  ElasticMapper.debug( logText );
};

ElasticMapper.debug = text => {
  if ( global.config.debug ) {
    console.log( text ); // eslint-disable-line no-console
  }
};

ElasticMapper.server = ( config = { } ) => {
  global.config = _.defaults( config, {
    environment: config.NODE_ENV || process.env.NODE_ENV || "development",
    tileSize: 256,
    debug: !( config.debug === false )
  } );
  global.config.log = global.config.log
    || `elasticmaps.${global.config.environment}.log`;
  global.config.elasticsearch = _.defaults(
    global.config.elasticsearch || { },
    {
      host: "localhost:9200",
      searchIndex: `elasticmaps_${global.config.environment}`,
      geoPointField: "location"
    }
  );
  // set default functions
  global.config.beforePrepareQuery = global.config.beforePrepareQuery
    || ElasticMapper.requestPassthrough;
  global.config.prepareQuery = global.config.prepareQuery
    || ElasticMapper.prepareQuery;
  global.config.prepareStyle = global.config.prepareStyle
    || ElasticMapper.requestPassthrough;
  global.config.beforeSendResult = global.config.beforeSendResult
    || ElasticMapper.requestResultPassthrough;
  // create the server and the map route
  const server = express( );
  if ( global.config.prepareApp && _.isFunction( global.config.prepareApp ) ) {
    global.config.prepareApp( server, config );
  }
  return server;
};

module.exports = ElasticMapper;
