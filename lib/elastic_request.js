var _ = require( "underscore" ),
    elasticsearch = require( "elasticsearch" ),
    MapGenerator = require( "./map_generator" ),
    ElasticRequest = { esClient: null };

ElasticRequest.createClient = function( ) {
  if( ElasticRequest.esClient === null ) {
    ElasticRequest.esClient = new elasticsearch.Client({
      host: global.config.elasticsearch.host,
      log: false
    });
  }
};

ElasticRequest.search = function( q, callback ) {
  var query = _.extend( { }, q );
  ElasticRequest.createClient( );
  ElasticRequest.esClient.search({
    preference: global.config.elasticsearch.preference || "_local",
    index: global.config.elasticsearch.searchIndex,
    body: query,
    searchType: ( query.size === 0 ? "count" : null ),
  }, callback );
};

ElasticRequest.expandBoxForSmoothEdges = function( qbbox ) {
  var height = Math.abs( qbbox[2] - qbbox[0] );
  var width = Math.abs( qbbox[3] - qbbox[1] );
  var factor = 0.10;
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
    return { or: [
      ElasticRequest.boundingBoxFilter( left, false ),
      ElasticRequest.boundingBoxFilter( right, false ) ] };
  }

  var field = global.config.elasticsearch.geoPointField;
  var boundingBox = { };
  boundingBox[field] = {
    bottom_left: [ qbbox[0], qbbox[1] ],
    top_right: [ qbbox[2], qbbox[3] ]
  };
  return { "geo_bounding_box" : boundingBox };
};

ElasticRequest.geohashPrecision = function( zoom ) {
  var precision = 3;
  if( zoom >= 2 ) { precision = 4; }
  if( zoom >= 4 ) { precision = 5; }
  if( zoom >= 6 ) { precision = 6; }
  if( zoom >= 9 ) { precision = 7; }
  if( zoom >= 10 ) { precision = 8; }
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
  MapGenerator.createMercator( );
  req.bbox = MapGenerator.merc.convert( MapGenerator.bboxFromParams( req ) );
  var bboxFilter = ElasticRequest.boundingBoxFilter( req.bbox );
  if( req.elastic_query.query.filtered ) {
    // there is an existing array of filters
    if( _.isArray( req.elastic_query.query.filtered.filter ) ) {
      req.elastic_query.query.filtered.filter.push( bboxFilter );
    }
    // there is an existing bool filter array
    else if( req.elastic_query.query.filtered.filter.bool &&
        _.isArray( req.elastic_query.query.filtered.filter.bool.must ) ) {
      req.elastic_query.query.filtered.filter.bool.must.push( bboxFilter );
    }
  } else {
    // query is not filtered yet, so make it a filtered query
    req.elastic_query.query = {
      filtered: {
        query: req.elastic_query.query,
        filter: bboxFilter
      }
    };
  }
};

ElasticRequest.geohashAggregation = function( req ) {
  return {
    zoom1: {
      geohash_grid: {
        field: global.config.elasticsearch.geoPointField,
        size: 50000,
        precision: ElasticRequest.geohashPrecision( req.params.zoom )
      },
      aggs: {
        geohash: {
          top_hits: {
            sort: { id: { order: "desc" } },
            _source: false,
            fielddata_fields: req.elastic_query.fields,
            size: 1
          }
        }
      }
    }
  };
};

module.exports = ElasticRequest;
