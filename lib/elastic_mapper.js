const express = require( "express" );
const querystring = require( "querystring" );
const _ = require( "lodash" );
const Geohash = require( "latlon-geohash" );
const MapGenerator = require( "./map_generator" );
const ElasticRequest = require( "./elastic_request" );

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

ElasticMapper.renderResult = ( req, res, data ) => {
  if ( req.params.format === "grid.json" ) {
    res.jsonp( data );
  } else {
    res.writeHead( 200, { "Content-Type": "image/png" } );
    res.end( data );
  }
};

ElasticMapper.prepareQuery = async req => {
  req.elastic_query = { };
  req.elastic_query.sort = { id: "desc" };
  req.query.source = { includes: ElasticRequest.defaultMapFields( ) };
  req.elastic_query.query = { bool: { } };
  switch ( req.params.style ) {
    case "points":
      req.elastic_query.size = 10000;
      break;
    case "geotile":
      req.geotilegrid = true;
      req.includeTotalHits = true;
      req.elastic_query.size = 0;
      req.elastic_query.aggregations = ElasticRequest.geohashAggregation( req );
      break;
    case "geohash":
      req.elastic_query.size = 0;
      if ( req.params.format === "torque.json" ) {
        req.elastic_query.aggregations = ElasticRequest.torqueAggregation( req );
      } else {
        req.elastic_query.aggregations = ElasticRequest.geohashAggregation( req );
      }
      break;
    default:
      // eslint-disable-next-line no-case-declarations
      const e = new Error( );
      e.status = 404;
      e.message = `unknown style: ${req.params.style}`;
      throw e;
  }
};

ElasticMapper.geotileGridGeojson = hit => {
  const parts = hit.key.split( "/" );
  MapGenerator.createMercator( );
  const bbox = MapGenerator.merc.bbox( parts[1], parts[2], parts[0] );
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox[0], bbox[1]],
        [bbox[2], bbox[1]],
        [bbox[2], bbox[3]],
        [bbox[0], bbox[3]],
        [bbox[0], bbox[1]]
      ]]
    },
    properties: {
      cellCount: hit.doc_count
    }
  };
};

ElasticMapper.geohashGridGeojson = hit => {
  const bbox = Geohash.bounds( hit.key );
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [bbox.sw.lon, bbox.sw.lat],
        [bbox.sw.lon, bbox.ne.lat],
        [bbox.ne.lon, bbox.ne.lat],
        [bbox.ne.lon, bbox.sw.lat],
        [bbox.sw.lon, bbox.sw.lat]
      ]]
    },
    properties: {
      cellCount: hit.doc_count
    }
  };
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
    // grids get rendered as polygons
    if ( req.geotilegrid && req.params.format !== "grid.json" ) {
      return ElasticMapper.geotileGridGeojson( hit );
    }
    if ( req.geogrid ) {
      return ElasticMapper.geohashGridGeojson( hit );
    }
    const fieldData = hit._source || hit.geohash.hits.hits[0]._source;
    fieldData.private_location = !_.isEmpty( fieldData.private_location );
    if ( !hit._source && hit.geohash ) {
      fieldData.cellCount = hit.geohash.hits.total.value;
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
    if ( req.geotilegrid ) {
      const parts = hit.key.split( "/" );
      MapGenerator.createMercator( );
      const bbox = MapGenerator.merc.bbox( parts[1], parts[2], parts[0] );
      latitude = _.mean( [bbox[1], bbox[3]] );
      longitude = _.mean( [bbox[0], bbox[2]] );
    } else if ( _.isObject( fieldData[geoPointField] ) ) {
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

ElasticMapper.route = async ( req, res ) => {
  req.startTime = Date.now( );
  req.params.zoom = parseInt( req.params.zoom, 10 );
  req.params.x = parseInt( req.params.x, 10 );
  req.params.y = parseInt( req.params.y, 10 );
  if ( req.params.zoom < 0 || req.params.zoom > 21 ) {
    ElasticMapper.renderMessage( res, "Invalid zoom", 404 );
    return;
  }
  const zoomDimension = 2 ** req.params.zoom;
  if ( req.params.x < 0 || req.params.x >= zoomDimension ) {
    ElasticMapper.renderMessage( res, "Invalid x value", 404 );
    return;
  }
  if ( req.params.y < 0 || req.params.y >= zoomDimension ) {
    ElasticMapper.renderMessage( res, "Invalid y value", 404 );
    return;
  }
  if ( !_.includes( ["png", "grid.json", "torque.json"], req.params.format ) ) {
    ElasticMapper.renderMessage( res, "Invalid format", 404 );
    return;
  }

  try {
    const prepareQuery = global.config.prepareQuery || ElasticMapper.prepareQuery;
    await prepareQuery( req );
    if ( req.includeTotalHits && req.params.dataType !== "postgis" ) {
      const cachedCount = await ElasticRequest.count( req, { }, this );
      req.totalHits = cachedCount || 0;
    }
    if ( req.params.dataType !== "postgis" ) {
      ElasticRequest.applyBoundingBoxFilter( req );
      const result = await ElasticRequest.search( req, { } );
      if ( req.params.format === "torque.json" ) {
        MapGenerator.torqueJson( result, req, res );
        return;
      }
      ElasticMapper.debug( `${result.took}ms / ${result.hits.total.value} results :: [${req.bbox}]` );
      req.csvData = ElasticMapper.csvFromResult( req, result );
    }
    if ( global.config.prepareStyle && req.params.format !== "grid.json" ) {
      await global.config.prepareStyle( req );
    }
    const { map, layer } = await MapGenerator.createMapTemplate( req );
    await MapGenerator.finishMap( req, res, map, layer, req.csvData );
    if ( global.config.beforeSendResult ) {
      await global.config.beforeSendResult( req, res );
    }
    req.endTime = new Date( );
    ElasticMapper.renderResult( req, res, req.tileData );
    if ( global.config.debug ) {
      ElasticMapper.printRequestLog( req );
    }
  } catch ( e ) {
    ElasticMapper.renderError( res, e );
  }
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
  // create the server and the map route
  const server = express( );
  if ( global.config.prepareApp && _.isFunction( global.config.prepareApp ) ) {
    global.config.prepareApp( server, config );
  }
  return server;
};

module.exports = ElasticMapper;
