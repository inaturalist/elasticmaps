const ElasticRequest = require( "../../lib/elastic_request" );
const EC = require( "../../lib/elastic_config" );

const helpers = { };

helpers.testConfig = ( ) => (
  { environment: "test", debug: false }
);

helpers.rebuildTestIndex = async ( ) => {
  ElasticRequest.createClient( );
  const indexOptions = { index: EC.config.elasticsearch.searchIndex };
  if ( await ElasticRequest.esClient.indices.exists( indexOptions ) ) {
    await ElasticRequest.esClient.indices.delete( indexOptions );
    await helpers.createTestIndex( );
  } else {
    await helpers.createTestIndex( );
  }
};

helpers.createTestIndex = async ( ) => {
  const body = {
    properties: {
      id: { type: "integer" },
      user: {
        properties: {
          name: { type: "text" }
        }
      },
      location: { type: "geo_point" },
      geojson: { type: "geo_shape" },
      observed_on_details: {
        properties: {
          month: { type: "byte" }
        }
      }
    }
  };
  const indexOptions = { index: EC.config.elasticsearch.searchIndex };
  await ElasticRequest.esClient.indices.create( indexOptions );
  await ElasticRequest.esClient.indices.putMapping( {
    ...indexOptions,
    body
  } );
  await ElasticRequest.esClient.create( {
    ...indexOptions,
    refresh: true,
    type: "_doc",
    id: "1",
    body: {
      id: 1,
      location: "51.18,-1.83",
      geojson: { type: "Point", coordinates: [-1.83, 51.18] },
      observed_on_details: {
        month: 1
      }
    }
  } );
};

helpers.deleteTestIndex = async ( ) => {
  ElasticRequest.createClient( );
  const indexOptions = { index: EC.config.elasticsearch.searchIndex };
  if ( await ElasticRequest.esClient.indices.exists( indexOptions ) ) {
    await ElasticRequest.esClient.indices.delete( indexOptions );
  }
};

module.exports = helpers;
