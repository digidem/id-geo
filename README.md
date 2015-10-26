# iD-geo - geo functions from [iDEditor](https://github.com/openstreetmap/iD)

[![build status](https://img.shields.io/travis/digidem/id-geo/master.svg)](https://travis-ci.org/digidem/id-geo)
[![npm version](https://img.shields.io/npm/v/id-geo.svg)](https://www.npmjs.com/package/id-geo)

**ALPHA:** see [TODO](#TODO)

## Overview

This packages up [iD Editor](https://github.com/openstreetmap/iD) iD.geo helper functions as an npm package to `require()` in your own projects.

## Usage

```sh
npm install id-geo
```

```js
var geo = require('id-geo');

var extent = new geo.Extent();
```

## Why

According to https://github.com/openstreetmap/iD/blob/master/ARCHITECTURE.md#core

> [iD] eventually aims to be a reusable, modular library to kickstart other
> JavaScript-based tools for OpenStreetMap.

The OSM data model is complex and hard to implement. iD is not published on npm and importing the whole iD project is excessive for a JavaScript based tool for OpenStreetMap. At [Digital Democracy](http://www.digital-democracy.org/) we are building tools on top of OSM, and borrowing from iD gives us a head start.

## How

iD does not use a commonJS module structure, so it's not as simple as `require`ing what is needed. We use [Smash](https://github.com/mbostock/smash) to concatenate just what is needed from d3 and iD editor to make things work. To rebuild from iD source files:

```sh
make clean && make
```

## Tests

```sh
npm install
npm test
```

Uses tests directly from iD to test exported objects.

## License

iD-geo is available under the [WTFPL](http://sam.zoy.org/wtfpl/), though obviously,
if you want to dual-license any contributions that's cool.
It includes [d3js](http://d3js.org/), which BSD-licensed.
