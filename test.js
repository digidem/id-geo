var chai = require('chai')
var expect = global.expect = chai.expect;
var _ = global._ = require('lodash');

chai.use(function (chai, utils) {
    var flag = utils.flag;

    chai.Assertion.addMethod('classed', function (className) {
        this.assert(
            flag(this, 'object').classed(className)
            , 'expected #{this} to be classed #{exp}'
            , 'expected #{this} not to be classed #{exp}'
            , className
        );
    });
});

var iD = global.iD = {
    geo: require('./'),
    areaKeys: {}
};

require('iD/js/id/util')
require('iD/js/id/core/entity')
require('iD/js/id/core/node')
require('iD/js/id/core/way')
require('iD/js/id/core/relation')
require('iD/js/id/core/graph')

require('iD/test/spec/geo');
require('iD/test/spec/geo/extent');
require('iD/test/spec/geo/intersection');
require('iD/test/spec/geo/multipolygon');
