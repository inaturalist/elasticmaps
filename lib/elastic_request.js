var http = require( "http" ),
    _ = require( "underscore" ),
    elasticsearch = require( "elasticsearch" ),
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
  var query = JSON.parse( JSON.stringify( q ) );
  if( query["query"] && query["query"]["filtered"] &&
      query["query"]["filtered"]["filter"] ) {
    query["query"]["filtered"]["filter"] = {
      "and": query["query"]["filtered"]["filter"]
    };
  }
  // console.log( JSON.stringify( query, null, "  " ) );
  ElasticRequest.createClient( );
  ElasticRequest.esClient.search({
    index: global.config.elasticsearch.searchIndex,
    body: query,
    searchType: ( query["size"] == 0 ? "count" : null ),
  }, callback );
};

ElasticRequest.expandBoxForSmoothEdges = function( qbbox ) {
  var height = Math.abs( qbbox[2] - qbbox[0] );
  var width = Math.abs( qbbox[3] - qbbox[1] );
  var factor = 0.10;
  qbbox[0] = qbbox[0] - ( height * factor )
  qbbox[2] = qbbox[2] + ( height * factor )
  qbbox[1] = qbbox[1] - ( width * factor )
  qbbox[3] = qbbox[3] + ( width * factor )
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
  precision = 3;
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
  return [ "id", "location" ];
};

ElasticRequest.defaultMapFilters = function( ) {
  return {
    filtered: {
      query: {
        match_all: { }
      },
      filter: [ ]
    }
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
            sort: {
              id: {
                order: "desc"
              }
            },
            _source: {
              include: req.elastic_query.fields
            },
            size: 1
          }
        }
      }
    }
  }
};

module.exports = ElasticRequest;
