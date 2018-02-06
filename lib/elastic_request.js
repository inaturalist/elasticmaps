var _ = require( "lodash" ),
    elasticsearch = require( "elasticsearch" ),
    MapGenerator = require( "./map_generator" ),
    ElasticRequest = { esClient: null };

ElasticRequest.createClient = function( ) {
  if( ElasticRequest.esClient === null ) {
    var clientConfig = { log: false };
    if( global.config.elasticsearch.hosts ) {
      clientConfig.hosts = _.isArray( global.config.elasticsearch.hosts ) ?
        global.config.elasticsearch.hosts :
        global.config.elasticsearch.hosts.split(" ");
    } else {
      clientConfig.host = global.config.elasticsearch.host;
    }
    ElasticRequest.esClient = new elasticsearch.Client( clientConfig );
  }
};

ElasticRequest.search = function( req, callback ) {
  var query = Object.assign( { }, req.elastic_query );
  ElasticRequest.createClient( );
  ElasticRequest.esClient.search({
    preference: global.config.elasticsearch.preference || "_local",
    index: req.elastic_index || global.config.elasticsearch.searchIndex,
    body: query
  }, callback );
};

ElasticRequest.expandBoxForSmoothEdges = function( qbbox ) {
  var height = Math.abs( qbbox[2] - qbbox[0] );
  var width = Math.abs( qbbox[3] - qbbox[1] );
  var factor = 0.07;
  qbbox[0] = qbbox[0] - ( height * factor );
  qbbox[2] = qbbox[2] + ( height * factor );
  qbbox[1] = qbbox[1] - ( width * factor );
  qbbox[3] = qbbox[3] + ( width * factor );
  if( qbbox[0] < -180 ) { qbbox[0] = -180; }
  if( qbbox[1] < -90 ) { qbbox[1] = -90; }
  if( qbbox[2] > 180 ) { qbbox[2] = 180; }
  if( qbbox[3] > 90 ) { qbbox[3] = 90; }
  return qbbox;
};

ElasticRequest.boundingBoxFilter = function( qbbox, smoothing ) {
  if( smoothing !== false) {
    qbbox = ElasticRequest.expandBoxForSmoothEdges( qbbox );
  }
  if( qbbox[2] < qbbox[0] ) {
    // the envelope crosses the dateline. Unfortunately, elasticsearch
    // doesn't handle this well and we need to split the envelope at
    // the dateline and do an OR query
    var left = _.clone( qbbox );
    var right =_.clone( qbbox );
    left[2] = 180;
    right[0] = -180;
    return { bool: { should: [
      ElasticRequest.boundingBoxFilter( left, false ),
      ElasticRequest.boundingBoxFilter( right, false ) ] } };
  }

  var field = global.config.elasticsearch.geoPointField;
  var boundingBox = { };
  boundingBox[field] = {
    bottom_left: [ qbbox[0], qbbox[1] ],
    top_right: [ qbbox[2], qbbox[3] ]
  };
  boundingBox.type = "indexed";
  return { "geo_bounding_box" : boundingBox };
};

ElasticRequest.geohashPrecision = function( zoom ) {
  var precision = 3;
  if( zoom >= 3 ) { precision = 4; }
  if( zoom >= 5 ) { precision = 5; }
  if( zoom >= 7 ) { precision = 6; }
  if( zoom >= 10 ) { precision = 7; }
  if( zoom >= 11 ) { precision = 8; }
  if( zoom >= 13 ) { precision = 9; }
  if( zoom >= 15 ) { precision = 10; }
  if( zoom >= 16 ) { precision = 12; }
  return precision;
};

ElasticRequest.defaultMapFields = function( ) {
  return [ "id", global.config.elasticsearch.geoPointField ];
};

ElasticRequest.defaultMapQuery = function( ) {
  return { match_all: { } };
};

ElasticRequest.applyBoundingBoxFilter = function( req ) {
  if( req.params.dataType === "geojson" ||
      req.params.dataType === "postgis" ) { return; }
  MapGenerator.createMercator( );
  req.bbox = MapGenerator.merc.convert( MapGenerator.bboxFromParams( req ) );
  var smoothing = req.params.format === "torque.json" ? false : true;
  var bboxFilter = ElasticRequest.boundingBoxFilter( req.bbox, smoothing );
  if( !req.elastic_query ) { req.elastic_query = { }; }
  if( !req.elastic_query.query ) { req.elastic_query.query = { }; }
  if( !req.elastic_query.query.bool ) { req.elastic_query.query.bool = { }; }
  if( !req.elastic_query.query.bool.filter ) { req.elastic_query.query.bool.filter = [ ]; }
  req.elastic_query.query.bool.filter.push( bboxFilter );
};

ElasticRequest.geohashAggregation = function( req ) {
  return {
    zoom1: {
      geohash_grid: {
        field: global.config.elasticsearch.geoPointField,
        size: 30000,
        precision: ElasticRequest.geohashPrecision( req.params.zoom )
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
};

ElasticRequest.torqueAggregation = function( req ) {
  const interval = req.query.interval === "weekly" ? "week" : "month";
  return {
    zoom1: {
      geohash_grid: {
        field: global.config.elasticsearch.geoPointField,
        size: 30000,
        precision: ElasticRequest.geohashPrecision( req.params.zoom )
      },
      aggs: {
        histogram: {
          terms: {
            field: `observed_on_details.${interval}`,
            size: 100
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
      }
    }
  };
};

module.exports = ElasticRequest;
