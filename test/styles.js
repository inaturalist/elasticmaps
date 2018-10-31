const { expect } = require( "chai" );
const Styles = require( "../lib/styles" );

describe( "Styles", ( ) => {
  describe( "points", ( ) => {
    it( "returns a style with the right name", ( ) => {
      expect( Styles.points( ) ).to.include( "Style name='style'" );
    } );
  } );
} );
