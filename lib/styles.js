var Styles = { };

Styles.points = function( ) {
  return "\
  <Style name='style' filter-mode='first'>\
    <Rule>\
      <MarkersSymbolizer width='8' stroke-width='0.5' multi-policy='whole' \
        fill='#D8D8D8' fill-opacity='1' stroke='#000000' stroke-opacity='1.0' \
        placement='point' marker-type='ellipse' allow-overlap='true' \
        comp-op='src' />\
    </Rule>\
  </Style>";
};

module.exports = Styles;
