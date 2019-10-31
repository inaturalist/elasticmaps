const ElasticRequest = require( "../../lib/elastic_request" );

const helpers = { };

helpers.testConfig = ( ) => (
  { environment: "test", debug: false }
);

helpers.rebuildTestIndex = callback => {
  ElasticRequest.createClient( );
  ElasticRequest.esClient.indices.exists(
    { index: global.config.elasticsearch.searchIndex }, ( err, bool ) => {
      if ( bool === true ) {
        ElasticRequest.esClient.indices.delete(
          { index: global.config.elasticsearch.searchIndex }, ( ) => {
            helpers.createTestIndex( callback );
          }
        );
      } else {
        helpers.createTestIndex( callback );
      }
    }
  );
};

helpers.createTestIndex = callback => {
  const body = {
    properties: {
      id: { type: "integer" },
      user: {
        properties: {
          name: { type: "text" }
        }
      },
      location: { type: "geo_point" },
      geojson: { type: "geo_shape" }
    }
  };
  ElasticRequest.esClient.indices.create(
    { index: global.config.elasticsearch.searchIndex }, ( ) => {
      ElasticRequest.esClient.indices.putMapping(
        { index: global.config.elasticsearch.searchIndex, body }, ( ) => {
          ElasticRequest.esClient.create( {
            index: global.config.elasticsearch.searchIndex,
            refresh: true,
            type: "_doc",
            id: "1",
            body: {
              id: 1,
              location: "51.18,-1.83",
              geojson: { type: "Point", coordinates: [-1.83, 51.18] }
            }
          }, callback );
        }
      );
    }
  );
};

helpers.deleteTestIndex = callback => {
  ElasticRequest.createClient( );
  ElasticRequest.esClient.indices.exists(
    { index: global.config.elasticsearch.searchIndex }, ( err, bool ) => {
      if ( bool === true ) {
        ElasticRequest.esClient.indices.delete(
          { index: global.config.elasticsearch.searchIndex }, callback
        );
      } else {
        callback( );
      }
    }
  );
};

module.exports = helpers;
