var expect = require( "chai" ).expect,
    request = require( "supertest" ),
    express = require( "express" ),
    _ = require( "lodash" ),
    Mapper = require( "../lib/elastic_mapper" ),
    ElasticRequest = require( "../lib/elastic_request" ),
    helpers = require( "./lib/helpers" ),
    app;


describe( "ElasticMapper", function( ) {
  before( function( done ) {
    this.timeout( 10000 );
    app = Mapper.server( helpers.testConfig( ) );
    app.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", Mapper.route );
    helpers.rebuildTestIndex( done );
  });

  after( function( done ) {
    helpers.deleteTestIndex( done );
  });

  describe( "routes", function( ) {
    it( "only knows one route", function( done ) {
      request( app ).get( "/" )
        .expect( function( res ) {
          expect( res.text ).to.include( "Cannot GET /" );
        }).expect( 404, done );
    });

    it( "allows new routes to be created", function( done ) {
      app.get( "/", function( req, res ) {
        res.send( "success" ).status( 200 ).end( );
      });
      request( app ).get( "/" ).expect( 200 )
        .expect( "success", done );
    });

    it( "accepts parameters", function( done ) {
      request( app ).get( "/points/1/0/0.png?param=test" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    });
  });

  describe( "validation", function( ) {
    it( "accepts the .png format", function( done ) {
      request( app ).get( "/points/1/0/0.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    });

    it( "accepts the .grid.json format", function( done ) {
      request( app ).get( "/points/1/1/1.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    });

    it( "errors on all other formats format", function( done ) {
      request( app ).get( "/points/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    });

    it( "returns an error for an unknown style", function( done ) {
      request( app ).get( "/nonsense/1/0/0.png" ).expect( 404 )
        .expect( "unknown style: nonsense", done );
    });

    it( "zoom must be 0 or above", function( done ) {
      request( app ).get( "/points/-1/0/0.png" ).expect( 404 )
        .expect( "Invalid zoom", done );
    });

    it( "zoom must be 21 or below", function( done ) {
      request( app ).get( "/points/22/0/0.png" ).expect( 404 )
        .expect( "Invalid zoom", done );
    });

    it( "x must be 0 or above", function( done ) {
      request( app ).get( "/points/5/-1/0.png" ).expect( 404 )
        .expect( "Invalid x value", done );
    });

    it( "x must be within range", function( done ) {
      request( app ).get( "/points/5/32/0.png" ).expect( 404 )
        .expect( "Invalid x value", done );
    });

    it( "y must be 0 or above", function( done ) {
      request( app ).get( "/points/5/0/-1.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    });

    it( "y must be within range", function( done ) {
      request( app ).get( "/points/5/0/32.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    });

    it( "y must be within range", function( done ) {
      request( app ).get( "/points/5/0/32.png" ).expect( 404 )
        .expect( "Invalid y value", done );
    });
  });

  describe( "points", function( ) {
    it( "renders .png", function( done ) {
      request( app ).get( "/points/1/1/1.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    });

    it( "renders .grid.json", function( done ) {
      request( app ).get( "/points/1/0/0.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    });

    it( "errors on all other formats format", function( done ) {
      request( app ).get( "/points/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    });
  });

  describe( "geohash", function( ) {
    it( "renders .png", function( done ) {
      request( app ).get( "/geohash/1/0/0.png" ).expect( 200 )
        .expect( "content-type", "image/png", done );
    });

    it( "renders .grid.json", function( done ) {
      request( app ).get( "/geohash/1/1/1.grid.json" ).expect( 200 )
        .expect( "content-type", "application/json; charset=utf-8", done );
    });

    it( "errors on all other formats format", function( done ) {
      request( app ).get( "/geohash/1/0/0.html" ).expect( 404 )
        .expect( "Invalid format", done );
    });
  });

  describe( "prepareStyle", function( ) {
    it( "renders errors", function( done ) {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareStyle: function( req, callback ) {
          callback( { message: "fail", status: 501 });
        }
      }));
      app.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 501 )
        .expect( "fail", done );
    });

    it( "errors on bad styles", function( done ) {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareStyle: function( req, callback ) {
          req.style = "nonsense";
          callback( req );
        }
      }));
      app.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 500 )
        .expect( "Error", done );
    });
  });

  describe( "renderError", function( ) {
    it( "defaults to 500 Error", function( done ) {
      app = Mapper.server( _.assignIn( helpers.testConfig( ), {
        prepareQuery: function( req, callback ) {
          callback( true );
        }
      }));
      app.get( "/:style/:zoom/:x/:y.:format([a-z\.]+)", Mapper.route );
      request( app ).get( "/points/1/0/0.png" ).expect( 500 )
        .expect( "Error", done );
    });
  });

  describe( "defaults", function( ) {
    it( "creates a default config", function( ) {
      app = Mapper.server( );
      expect( global.config.environment ).to.eql( "development" );
      expect( global.config.tileSize ).to.eql( 256 );
      expect( global.config.debug ).to.eql( true );
    });
  });

});
