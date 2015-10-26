# See the README for installation instructions.

all: \
	lib/d3.js \
	index.js

clean:
	rm -f lib/d3.js index.js

D3_FILES = \
	node_modules/d3/src/start.js \
	node_modules/d3/src/geo/mercator.js \
	node_modules/d3/src/geo/transform.js \
	lib/d3.end.js

lib/d3.js: node_modules/.install $(D3_FILES) lib/d3.end.js
	node_modules/.bin/smash $(D3_FILES) > $@

ID_GEO_FILES = \
	start.js \
  node_modules/iD/js/id/geo.js \
  node_modules/iD/js/id/geo/extent.js \
  node_modules/iD/js/id/geo/intersection.js \
  node_modules/iD/js/id/geo/multipolygon.js \
  node_modules/iD/js/id/geo/raw_mercator.js \
  node_modules/iD/js/id/actions/reverse.js \
  node_modules/iD/js/id/core/entity.js \
  node_modules/iD/js/id/core/way.js \
  end.js

index.js: node_modules/.install  $(ID_GEO_FILES) start.js end.js
	node_modules/.bin/smash $(ID_GEO_FILES) > $@

node_modules/.install: package.json
	npm install && touch node_modules/.install
