const { expect } = require( "chai" );
const request = require( "supertest" );
const _ = require( "lodash" );
const Mapper = require( "../lib/elastic_mapper" );
const helpers = require( "./lib/helpers" );

let app;

describe( "ElasticMapper", ( ) => {
  before( async function ( ) {
    this.timeout( 10000 );
    app = Mapper.server( helpers.testConfig( ) );
    app.get( "/:style/:zoom/:x/:y.:format([a-z.]+)", Mapper.route );
    await helpers.rebuildTestIndex( );
  } );

  after( async ( ) => {
    await helpers.deleteTestIndex( );
  } );

  describe( "routes", ( ) => {
    it( "only knows one route", done => {
      request( app ).get( "/" )
        .expect( res => {
          expect( res.text ).to.include( "Cannot GET /" );
        } ).expect( 404, done );
    } );

    it( "allows new routes to be created", done => {
      app.get( "/fails", ( req, res ) => {
        res.send( "success" ).status( 200 ).end( );
      } );
      request( app ).get( "/" ).expect( 200 )
        .expect( "success", done );
    } );

    it( "accepts parameters", done => {
      request( app ).get( "/points/1/0/0.png?param=test" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    } );
  } );

  describe( "validation", ( ) => {
    it( "accepts the .png format", done => {
      request( app ).get( "/points/1/0/0.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    } );

    it( "accepts the .grid.json format", done => {
      request( app ).get( "/points/1/1/1.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    } );

    it( "errors on all other formats format", done => {
      request( app ).get( "/points/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    } );

    it( "returns an error for an unknown style", done => {
      request( app ).get( "/nonsense/1/0/0.png" ).expect( 404 )
        .expect( "unknown style: nonsense", done );
    } );

    it( "zoom must be 0 or above", done => {
      request( app ).get( "/points/-1/0/0.png" ).expect( 404 )
        .expect( "Invalid zoom", done );
    } );

    it( "zoom must be 21 or below", done => {
      request( app ).get( "/points/22/0/0.png" ).expect( 404 )
        .expect( "Invalid zoom", done );
    } );

    it( "x must be 0 or above", done => {
      request( app ).get( "/points/5/-1/0.png" ).expect( 404 )
        .expect( "Invalid x value", done );
    } );

    it( "x must be within range", done => {
      request( app ).get( "/points/5/32/0.png" ).expect( 404 )
        .expect( "Invalid x value", done );
    } );

    it( "y must be 0 or above", done => {
      request( app ).get( "/points/5/0/-1.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    } );

    it( "y must be within range", done => {
      request( app ).get( "/points/5/0/32.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    } );

    it( "y must be within range", done => {
      request( app ).get( "/points/5/0/32.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    } );
  } );

  describe( "points", ( ) => {
    it( "renders .png", done => {
      request( app ).get( "/points/1/1/1.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    } );

    it( "renders .grid.json", done => {
      request( app ).get( "/points/1/0/0.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    } );

    it( "errors on all other formats format", done => {
      request( app ).get( "/points/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    } );
  } );

  describe( "geohash", ( ) => {
    it( "renders .png", done => {
      request( app ).get( "/geohash/1/0/0.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    } );

    it( "renders .grid.json", done => {
      request( app ).get( "/geohash/1/1/0.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    } );

    it( "renders .torque.json", done => {
      request( app ).get( "/geohash/1/0/0.torque.json" )
        .expect( res => {
          expect( res.text ).to.include( "x__uint8" );
          expect( res.text ).to.include( "y__uint8" );
          expect( res.text ).to.include( "vals__uint8" );
        } )
        .expect( 200 )
        .expect( "content-type", "text/html; charset=utf-8", done );
    } );

    it( "errors on all other formats format", done => {
      request( app ).get( "/geohash/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    } );
  } );

  describe( "geotile", ( ) => {
    it( "renders .png", done => {
      request( app ).get( "/geotile/1/0/0.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    } );

    it( "renders .grid.json", done => {
      request( app ).get( "/geotile/1/1/0.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    } );

    it( "errors on all other formats format", done => {
      request( app ).get( "/geotile/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    } );
  } );

  describe( "prepareStyle", ( ) => {
    it( "renders errors", done => {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareStyle: ( ) => {
          const e = new Error( );
          e.status = 501;
          e.message = "fail";
          throw e;
        }
      } ) );
      app.get( "/:style/:zoom/:x/:y.:format([a-z.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 501 )
        .expect( "fail", done );
    } );

    it( "errors on bad styles", done => {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareStyle: req => {
          req.style = "nonsense";
        }
      } ) );
      app.get( "/:style/:zoom/:x/:y.:format([a-z.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 500 )
        .expect( "Error", done );
    } );
  } );

  describe( "renderError", ( ) => {
    it( "defaults to 500 Error", done => {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareQuery: ( ) => {
          throw new Error( );
        }
      } ) );
      app.get( "/:style/:zoom/:x/:y.:format([a-z.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 500 )
        .expect( "Error", done );
    } );
  } );

  describe( "defaults", ( ) => {
    it( "creates a default config", ( ) => {
      app = Mapper.server( );
      expect( global.config.environment ).to.eql( "development" );
      expect( global.config.tileSize ).to.eql( 256 );
      expect( global.config.debug ).to.eql( true );
    } );
  } );
} );
