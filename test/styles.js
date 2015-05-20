var expect = require( "chai" ).expect,
    Styles = require( "../lib/styles" );

describe( "Styles", function( ) {
  describe( "points", function( ) {
    it( "returns a style with the right name", function( ) {
      expect( Styles.points( ) ).to.include( "Style name='style'" );
    });
  });
});
