var ElasticRequest = require( "../../lib/elastic_request" ),
    helpers = { };

helpers.testConfig = function( ) {
  return { environment: "test", debug: false };
};

helpers.rebuildTestIndex = function( callback ) {
  ElasticRequest.createClient( );
  ElasticRequest.esClient.indices.exists(
    { index: global.config.elasticsearch.searchIndex }, function( err, bool ) {
    if( bool === true ) {
      ElasticRequest.esClient.indices.delete(
        { index: global.config.elasticsearch.searchIndex }, function( ) {
        helpers.createTestIndex( callback );
      });
    } else {
      helpers.createTestIndex( callback );
    }
  });
}

helpers.createTestIndex = function( callback ) {
  var body = {
    map_point: {
      properties: {
        id: { type: "integer" },
        user: {
          properties: {
            name: { type: "string" },
          }
        },
        location: { type: "geo_point", lat_lon: true,
          geohash: true, geohash_precision: 10 },
        geojson: { type: "geo_shape" }
      }
    }
  }
  ElasticRequest.esClient.indices.create(
    { index: global.config.elasticsearch.searchIndex }, function( ) {
    ElasticRequest.esClient.indices.putMapping(
      { index: global.config.elasticsearch.searchIndex, type: "map_point", body: body }, function( ) {
        ElasticRequest.esClient.create({
          index: global.config.elasticsearch.searchIndex,
          refresh: true,
          type: "map_point",
          id: 1,
          body: {
            id: 1,
            location: "51.18,-1.83",
            geojson: { type: "Point", coordinates: [ -1.83, 51.18 ] }
          }
        }, callback);
      });
  });
}

helpers.deleteTestIndex = function( callback ) {
  ElasticRequest.createClient( );
  ElasticRequest.esClient.indices.exists(
    { index: global.config.elasticsearch.searchIndex }, function( err, bool ) {
    if( bool === true ) {
      ElasticRequest.esClient.indices.delete(
        { index: global.config.elasticsearch.searchIndex }, callback);
    } else {
      callback( );
    }
  });
}

module.exports = helpers;
