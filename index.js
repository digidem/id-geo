var _ = require('lodash');
var rbush = require('rbush');
var d3 = require('./lib/d3');

var iD = {
    actions: {}
};
iD.geo = {};

iD.geo.roundCoords = function(c) {
    return [Math.floor(c[0]), Math.floor(c[1])];
};

iD.geo.interp = function(p1, p2, t) {
    return [p1[0] + (p2[0] - p1[0]) * t,
            p1[1] + (p2[1] - p1[1]) * t];
};

// 2D cross product of OA and OB vectors, i.e. z-component of their 3D cross product.
// Returns a positive value, if OAB makes a counter-clockwise turn,
// negative for clockwise turn, and zero if the points are collinear.
iD.geo.cross = function(o, a, b) {
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
};

// http://jsperf.com/id-dist-optimization
iD.geo.euclideanDistance = function(a, b) {
    var x = a[0] - b[0], y = a[1] - b[1];
    return Math.sqrt((x * x) + (y * y));
};

// using WGS84 polar radius (6356752.314245179 m)
// const = 2 * PI * r / 360
iD.geo.latToMeters = function(dLat) {
    return dLat * 110946.257617;
};

// using WGS84 equatorial radius (6378137.0 m)
// const = 2 * PI * r / 360
iD.geo.lonToMeters = function(dLon, atLat) {
    return Math.abs(atLat) >= 90 ? 0 :
        dLon * 111319.490793 * Math.abs(Math.cos(atLat * (Math.PI/180)));
};

// using WGS84 polar radius (6356752.314245179 m)
// const = 2 * PI * r / 360
iD.geo.metersToLat = function(m) {
    return m / 110946.257617;
};

// using WGS84 equatorial radius (6378137.0 m)
// const = 2 * PI * r / 360
iD.geo.metersToLon = function(m, atLat) {
    return Math.abs(atLat) >= 90 ? 0 :
        m / 111319.490793 / Math.abs(Math.cos(atLat * (Math.PI/180)));
};

// Equirectangular approximation of spherical distances on Earth
iD.geo.sphericalDistance = function(a, b) {
    var x = iD.geo.lonToMeters(a[0] - b[0], (a[1] + b[1]) / 2),
        y = iD.geo.latToMeters(a[1] - b[1]);
    return Math.sqrt((x * x) + (y * y));
};

iD.geo.edgeEqual = function(a, b) {
    return (a[0] === b[0] && a[1] === b[1]) ||
        (a[0] === b[1] && a[1] === b[0]);
};

// Return the counterclockwise angle in the range (-pi, pi)
// between the positive X axis and the line intersecting a and b.
iD.geo.angle = function(a, b, projection) {
    a = projection(a.loc);
    b = projection(b.loc);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
};

// Choose the edge with the minimal distance from `point` to its orthogonal
// projection onto that edge, if such a projection exists, or the distance to
// the closest vertex on that edge. Returns an object with the `index` of the
// chosen edge, the chosen `loc` on that edge, and the `distance` to to it.
iD.geo.chooseEdge = function(nodes, point, projection) {
    var dist = iD.geo.euclideanDistance,
        points = nodes.map(function(n) { return projection(n.loc); }),
        min = Infinity,
        idx, loc;

    function dot(p, q) {
        return p[0] * q[0] + p[1] * q[1];
    }

    for (var i = 0; i < points.length - 1; i++) {
        var o = points[i],
            s = [points[i + 1][0] - o[0],
                 points[i + 1][1] - o[1]],
            v = [point[0] - o[0],
                 point[1] - o[1]],
            proj = dot(v, s) / dot(s, s),
            p;

        if (proj < 0) {
            p = o;
        } else if (proj > 1) {
            p = points[i + 1];
        } else {
            p = [o[0] + proj * s[0], o[1] + proj * s[1]];
        }

        var d = dist(p, point);
        if (d < min) {
            min = d;
            idx = i + 1;
            loc = projection.invert(p);
        }
    }

    return {
        index: idx,
        distance: min,
        loc: loc
    };
};

// Return the intersection point of 2 line segments.
// From https://github.com/pgkelley4/line-segments-intersect
// This uses the vector cross product approach described below:
//  http://stackoverflow.com/a/565282/786339
iD.geo.lineIntersection = function(a, b) {
    function subtractPoints(point1, point2) {
        return [point1[0] - point2[0], point1[1] - point2[1]];
    }
    function crossProduct(point1, point2) {
        return point1[0] * point2[1] - point1[1] * point2[0];
    }

    var p = [a[0][0], a[0][1]],
        p2 = [a[1][0], a[1][1]],
        q = [b[0][0], b[0][1]],
        q2 = [b[1][0], b[1][1]],
        r = subtractPoints(p2, p),
        s = subtractPoints(q2, q),
        uNumerator = crossProduct(subtractPoints(q, p), r),
        denominator = crossProduct(r, s);

    if (uNumerator && denominator) {
        var u = uNumerator / denominator,
            t = crossProduct(subtractPoints(q, p), s) / denominator;

        if ((t >= 0) && (t <= 1) && (u >= 0) && (u <= 1)) {
            return iD.geo.interp(p, p2, t);
        }
    }

    return null;
};

iD.geo.pathIntersections = function(path1, path2) {
    var intersections = [];
    for (var i = 0; i < path1.length - 1; i++) {
        for (var j = 0; j < path2.length - 1; j++) {
            var a = [ path1[i], path1[i+1] ],
                b = [ path2[j], path2[j+1] ],
                hit = iD.geo.lineIntersection(a, b);
            if (hit) intersections.push(hit);
        }
    }
    return intersections;
};

// Return whether point is contained in polygon.
//
// `point` should be a 2-item array of coordinates.
// `polygon` should be an array of 2-item arrays of coordinates.
//
// From https://github.com/substack/point-in-polygon.
// ray-casting algorithm based on
// http://www.ecse.rpi.edu/Homepages/wrf/Research/Short_Notes/pnpoly.html
//
iD.geo.pointInPolygon = function(point, polygon) {
    var x = point[0],
        y = point[1],
        inside = false;

    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        var xi = polygon[i][0], yi = polygon[i][1];
        var xj = polygon[j][0], yj = polygon[j][1];

        var intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
};

iD.geo.polygonContainsPolygon = function(outer, inner) {
    return _.every(inner, function(point) {
        return iD.geo.pointInPolygon(point, outer);
    });
};

iD.geo.polygonIntersectsPolygon = function(outer, inner, checkSegments) {
    function testSegments(outer, inner) {
        for (var i = 0; i < outer.length - 1; i++) {
            for (var j = 0; j < inner.length - 1; j++) {
                var a = [ outer[i], outer[i+1] ],
                    b = [ inner[j], inner[j+1] ];
                if (iD.geo.lineIntersection(a, b)) return true;
            }
        }
        return false;
    }

    function testPoints(outer, inner) {
        return _.some(inner, function(point) {
            return iD.geo.pointInPolygon(point, outer);
        });
    }

   return testPoints(outer, inner) || (!!checkSegments && testSegments(outer, inner));
};

iD.geo.pathLength = function(path) {
    var length = 0,
        dx, dy;
    for (var i = 0; i < path.length - 1; i++) {
        dx = path[i][0] - path[i + 1][0];
        dy = path[i][1] - path[i + 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
};
iD.geo.Extent = function geoExtent(min, max) {
    if (!(this instanceof iD.geo.Extent)) return new iD.geo.Extent(min, max);
    if (min instanceof iD.geo.Extent) {
        return min;
    } else if (min && min.length === 2 && min[0].length === 2 && min[1].length === 2) {
        this[0] = min[0];
        this[1] = min[1];
    } else {
        this[0] = min        || [ Infinity,  Infinity];
        this[1] = max || min || [-Infinity, -Infinity];
    }
};

iD.geo.Extent.prototype = new Array(2);

_.extend(iD.geo.Extent.prototype, {
    equals: function (obj) {
        return this[0][0] === obj[0][0] &&
            this[0][1] === obj[0][1] &&
            this[1][0] === obj[1][0] &&
            this[1][1] === obj[1][1];
    },

    extend: function(obj) {
        if (!(obj instanceof iD.geo.Extent)) obj = new iD.geo.Extent(obj);
        return iD.geo.Extent([Math.min(obj[0][0], this[0][0]),
                              Math.min(obj[0][1], this[0][1])],
                             [Math.max(obj[1][0], this[1][0]),
                              Math.max(obj[1][1], this[1][1])]);
    },

    _extend: function(extent) {
        this[0][0] = Math.min(extent[0][0], this[0][0]);
        this[0][1] = Math.min(extent[0][1], this[0][1]);
        this[1][0] = Math.max(extent[1][0], this[1][0]);
        this[1][1] = Math.max(extent[1][1], this[1][1]);
    },

    area: function() {
        return Math.abs((this[1][0] - this[0][0]) * (this[1][1] - this[0][1]));
    },

    center: function() {
        return [(this[0][0] + this[1][0]) / 2,
                (this[0][1] + this[1][1]) / 2];
    },

    polygon: function() {
        return [
            [this[0][0], this[0][1]],
            [this[0][0], this[1][1]],
            [this[1][0], this[1][1]],
            [this[1][0], this[0][1]],
            [this[0][0], this[0][1]]
        ];
    },

    contains: function(obj) {
        if (!(obj instanceof iD.geo.Extent)) obj = new iD.geo.Extent(obj);
        return obj[0][0] >= this[0][0] &&
               obj[0][1] >= this[0][1] &&
               obj[1][0] <= this[1][0] &&
               obj[1][1] <= this[1][1];
    },

    intersects: function(obj) {
        if (!(obj instanceof iD.geo.Extent)) obj = new iD.geo.Extent(obj);
        return obj[0][0] <= this[1][0] &&
               obj[0][1] <= this[1][1] &&
               obj[1][0] >= this[0][0] &&
               obj[1][1] >= this[0][1];
    },

    intersection: function(obj) {
        if (!this.intersects(obj)) return new iD.geo.Extent();
        return new iD.geo.Extent([Math.max(obj[0][0], this[0][0]),
                                  Math.max(obj[0][1], this[0][1])],
                                 [Math.min(obj[1][0], this[1][0]),
                                  Math.min(obj[1][1], this[1][1])]);
    },

    percentContainedIn: function(obj) {
        if (!(obj instanceof iD.geo.Extent)) obj = new iD.geo.Extent(obj);
        var a1 = this.intersection(obj).area(),
            a2 = this.area();

        if (a1 === Infinity || a2 === Infinity || a1 === 0 || a2 === 0) {
            return 0;
        } else {
            return a1 / a2;
        }
    },

    padByMeters: function(meters) {
        var dLat = iD.geo.metersToLat(meters),
            dLon = iD.geo.metersToLon(meters, this.center()[1]);
        return iD.geo.Extent(
                [this[0][0] - dLon, this[0][1] - dLat],
                [this[1][0] + dLon, this[1][1] + dLat]);
    },

    toParam: function() {
        return [this[0][0], this[0][1], this[1][0], this[1][1]].join(',');
    }

});
iD.geo.Turn = function(turn) {
    if (!(this instanceof iD.geo.Turn))
        return new iD.geo.Turn(turn);
    _.extend(this, turn);
};

iD.geo.Intersection = function(graph, vertexId) {
    var vertex = graph.entity(vertexId),
        highways = [];

    // Pre-split ways that would need to be split in
    // order to add a restriction. The real split will
    // happen when the restriction is added.
    graph.parentWays(vertex).forEach(function(way) {
        if (!way.tags.highway || way.isArea() || way.isDegenerate())
            return;

        if (way.affix(vertexId)) {
            highways.push(way);
        } else {
            var idx = _.indexOf(way.nodes, vertex.id, 1),
                wayA = iD.Way({id: way.id + '-a', tags: way.tags, nodes: way.nodes.slice(0, idx + 1)}),
                wayB = iD.Way({id: way.id + '-b', tags: way.tags, nodes: way.nodes.slice(idx)});

            graph = graph.replace(wayA);
            graph = graph.replace(wayB);

            highways.push(wayA);
            highways.push(wayB);
        }
    });

    var intersection = {
        highways: highways,
        graph: graph
    };

    intersection.turns = function(fromNodeID) {
        if (!fromNodeID)
            return [];

        var way = _.find(highways, function(way) { return way.contains(fromNodeID); });
        if (way.first() === vertex.id && way.tags.oneway === 'yes')
            return [];
        if (way.last() === vertex.id && way.tags.oneway === '-1')
            return [];

        function withRestriction(turn) {
            graph.parentRelations(graph.entity(turn.from.way)).forEach(function(relation) {
                if (relation.tags.type !== 'restriction')
                    return;

                var f = relation.memberByRole('from'),
                    t = relation.memberByRole('to'),
                    v = relation.memberByRole('via');

                if (f && f.id === turn.from.way &&
                    v && v.id === turn.via.node &&
                    t && t.id === turn.to.way) {
                    turn.restriction = relation.id;
                } else if (/^only_/.test(relation.tags.restriction) &&
                    f && f.id === turn.from.way &&
                    v && v.id === turn.via.node &&
                    t && t.id !== turn.to.way) {
                    turn.restriction = relation.id;
                    turn.indirect_restriction = true;
                }
            });

            return iD.geo.Turn(turn);
        }

        var from = {
                node: way.nodes[way.first() === vertex.id ? 1 : way.nodes.length - 2],
                way: way.id.split(/-(a|b)/)[0]
            },
            via = {node: vertex.id},
            turns = [];

        highways.forEach(function(parent) {
            if (parent === way)
                return;

            var index = parent.nodes.indexOf(vertex.id);

            // backward
            if (parent.first() !== vertex.id && parent.tags.oneway !== 'yes') {
                turns.push(withRestriction({
                    from: from,
                    via: via,
                    to: {node: parent.nodes[index - 1], way: parent.id.split(/-(a|b)/)[0]}
                }));
            }

            // forward
            if (parent.last() !== vertex.id && parent.tags.oneway !== '-1') {
                turns.push(withRestriction({
                    from: from,
                    via: via,
                    to: {node: parent.nodes[index + 1], way: parent.id.split(/-(a|b)/)[0]}
                }));
            }
        });

        // U-turn
        if (way.tags.oneway !== 'yes' && way.tags.oneway !== '-1') {
            turns.push(withRestriction({
                from: from,
                via: via,
                to: from,
                u: true
            }));
        }

        return turns;
    };

    return intersection;
};


iD.geo.inferRestriction = function(graph, from, via, to, projection) {
    var fromWay = graph.entity(from.way),
        fromNode = graph.entity(from.node),
        toWay = graph.entity(to.way),
        toNode = graph.entity(to.node),
        viaNode = graph.entity(via.node),
        fromOneWay = (fromWay.tags.oneway === 'yes' && fromWay.last() === via.node) ||
            (fromWay.tags.oneway === '-1' && fromWay.first() === via.node),
        toOneWay = (toWay.tags.oneway === 'yes' && toWay.first() === via.node) ||
            (toWay.tags.oneway === '-1' && toWay.last() === via.node),
        angle = iD.geo.angle(viaNode, fromNode, projection) -
                iD.geo.angle(viaNode, toNode, projection);

    angle = angle * 180 / Math.PI;

    while (angle < 0)
        angle += 360;

    if (fromNode === toNode)
        return 'no_u_turn';
    if ((angle < 23 || angle > 336) && fromOneWay && toOneWay)
        return 'no_u_turn';
    if (angle < 158)
        return 'no_right_turn';
    if (angle > 202)
        return 'no_left_turn';

    return 'no_straight_on';
};
// For fixing up rendering of multipolygons with tags on the outer member.
// https://github.com/openstreetmap/iD/issues/613
iD.geo.isSimpleMultipolygonOuterMember = function(entity, graph) {
    if (entity.type !== 'way')
        return false;

    var parents = graph.parentRelations(entity);
    if (parents.length !== 1)
        return false;

    var parent = parents[0];
    if (!parent.isMultipolygon() || Object.keys(parent.tags).length > 1)
        return false;

    var members = parent.members, member;
    for (var i = 0; i < members.length; i++) {
        member = members[i];
        if (member.id === entity.id && member.role && member.role !== 'outer')
            return false; // Not outer member
        if (member.id !== entity.id && (!member.role || member.role === 'outer'))
            return false; // Not a simple multipolygon
    }

    return parent;
};

iD.geo.simpleMultipolygonOuterMember = function(entity, graph) {
    if (entity.type !== 'way')
        return false;

    var parents = graph.parentRelations(entity);
    if (parents.length !== 1)
        return false;

    var parent = parents[0];
    if (!parent.isMultipolygon() || Object.keys(parent.tags).length > 1)
        return false;

    var members = parent.members, member, outerMember;
    for (var i = 0; i < members.length; i++) {
        member = members[i];
        if (!member.role || member.role === 'outer') {
            if (outerMember)
                return false; // Not a simple multipolygon
            outerMember = member;
        }
    }

    return outerMember && graph.hasEntity(outerMember.id);
};

// Join `array` into sequences of connecting ways.
//
// Segments which share identical start/end nodes will, as much as possible,
// be connected with each other.
//
// The return value is a nested array. Each constituent array contains elements
// of `array` which have been determined to connect. Each consitituent array
// also has a `nodes` property whose value is an ordered array of member nodes,
// with appropriate order reversal and start/end coordinate de-duplication.
//
// Members of `array` must have, at minimum, `type` and `id` properties.
// Thus either an array of `iD.Way`s or a relation member array may be
// used.
//
// If an member has a `tags` property, its tags will be reversed via
// `iD.actions.Reverse` in the output.
//
// Incomplete members (those for which `graph.hasEntity(element.id)` returns
// false) and non-way members are ignored.
//
iD.geo.joinWays = function(array, graph) {
    var joined = [], member, current, nodes, first, last, i, how, what;

    array = array.filter(function(member) {
        return member.type === 'way' && graph.hasEntity(member.id);
    });

    function resolve(member) {
        return graph.childNodes(graph.entity(member.id));
    }

    function reverse(member) {
        return member.tags ? iD.actions.Reverse(member.id)(graph).entity(member.id) : member;
    }

    while (array.length) {
        member = array.shift();
        current = [member];
        current.nodes = nodes = resolve(member).slice();
        joined.push(current);

        while (array.length && _.first(nodes) !== _.last(nodes)) {
            first = _.first(nodes);
            last  = _.last(nodes);

            for (i = 0; i < array.length; i++) {
                member = array[i];
                what = resolve(member);

                if (last === _.first(what)) {
                    how  = nodes.push;
                    what = what.slice(1);
                    break;
                } else if (last === _.last(what)) {
                    how  = nodes.push;
                    what = what.slice(0, -1).reverse();
                    member = reverse(member);
                    break;
                } else if (first === _.last(what)) {
                    how  = nodes.unshift;
                    what = what.slice(0, -1);
                    break;
                } else if (first === _.first(what)) {
                    how  = nodes.unshift;
                    what = what.slice(1).reverse();
                    member = reverse(member);
                    break;
                } else {
                    what = how = null;
                }
            }

            if (!what)
                break; // No more joinable ways.

            how.apply(current, [member]);
            how.apply(nodes, what);

            array.splice(i, 1);
        }
    }

    return joined;
};
/*
    Bypasses features of D3's default projection stream pipeline that are unnecessary:
    * Antimeridian clipping
    * Spherical rotation
    * Resampling
*/
iD.geo.RawMercator = function () {
    var project = d3.geo.mercator.raw,
        k = 512 / Math.PI, // scale
        x = 0, y = 0, // translate
        clipExtent = [[0, 0], [0, 0]];

    function projection(point) {
        point = project(point[0] * Math.PI / 180, point[1] * Math.PI / 180);
        return [point[0] * k + x, y - point[1] * k];
    }

    projection.invert = function(point) {
        point = project.invert((point[0] - x) / k, (y - point[1]) / k);
        return point && [point[0] * 180 / Math.PI, point[1] * 180 / Math.PI];
    };

    projection.scale = function(_) {
        if (!arguments.length) return k;
        k = +_;
        return projection;
    };

    projection.translate = function(_) {
        if (!arguments.length) return [x, y];
        x = +_[0];
        y = +_[1];
        return projection;
    };

    projection.clipExtent = function(_) {
        if (!arguments.length) return clipExtent;
        clipExtent = _;
        return projection;
    };

    projection.stream = d3.geo.transform({
        point: function(x, y) {
            x = projection([x, y]);
            this.stream.point(x[0], x[1]);
        }
    }).stream;

    return projection;
};
/*
  Order the nodes of a way in reverse order and reverse any direction dependent tags
  other than `oneway`. (We assume that correcting a backwards oneway is the primary
  reason for reversing a way.)

  The following transforms are performed:

    Keys:
          *:right=* ⟺ *:left=*
        *:forward=* ⟺ *:backward=*
       direction=up ⟺ direction=down
         incline=up ⟺ incline=down
            *=right ⟺ *=left

    Relation members:
       role=forward ⟺ role=backward
         role=north ⟺ role=south
          role=east ⟺ role=west

   In addition, numeric-valued `incline` tags are negated.

   The JOSM implementation was used as a guide, but transformations that were of unclear benefit
   or adjusted tags that don't seem to be used in practice were omitted.

   References:
      http://wiki.openstreetmap.org/wiki/Forward_%26_backward,_left_%26_right
      http://wiki.openstreetmap.org/wiki/Key:direction#Steps
      http://wiki.openstreetmap.org/wiki/Key:incline
      http://wiki.openstreetmap.org/wiki/Route#Members
      http://josm.openstreetmap.de/browser/josm/trunk/src/org/openstreetmap/josm/corrector/ReverseWayTagCorrector.java
 */
iD.actions.Reverse = function(wayId) {
    var replacements = [
            [/:right$/, ':left'], [/:left$/, ':right'],
            [/:forward$/, ':backward'], [/:backward$/, ':forward']
        ],
        numeric = /^([+\-]?)(?=[\d.])/,
        roleReversals = {
            forward: 'backward',
            backward: 'forward',
            north: 'south',
            south: 'north',
            east: 'west',
            west: 'east'
        };

    function reverseKey(key) {
        for (var i = 0; i < replacements.length; ++i) {
            var replacement = replacements[i];
            if (replacement[0].test(key)) {
                return key.replace(replacement[0], replacement[1]);
            }
        }
        return key;
    }

    function reverseValue(key, value) {
        if (key === 'incline' && numeric.test(value)) {
            return value.replace(numeric, function(_, sign) { return sign === '-' ? '' : '-'; });
        } else if (key === 'incline' || key === 'direction') {
            return {up: 'down', down: 'up'}[value] || value;
        } else {
            return {left: 'right', right: 'left'}[value] || value;
        }
    }

    return function(graph) {
        var way = graph.entity(wayId),
            nodes = way.nodes.slice().reverse(),
            tags = {}, key, role;

        for (key in way.tags) {
            tags[reverseKey(key)] = reverseValue(key, way.tags[key]);
        }

        graph.parentRelations(way).forEach(function(relation) {
            relation.members.forEach(function(member, index) {
                if (member.id === way.id && (role = roleReversals[member.role])) {
                    relation = relation.updateMember({role: role}, index);
                    graph = graph.replace(relation);
                }
            });
        });

        return graph.replace(way.update({nodes: nodes, tags: tags}));
    };
};
iD.Entity = function(attrs) {
    // For prototypal inheritance.
    if (this instanceof iD.Entity) return;

    // Create the appropriate subtype.
    if (attrs && attrs.type) {
        return iD.Entity[attrs.type].apply(this, arguments);
    } else if (attrs && attrs.id) {
        return iD.Entity[iD.Entity.id.type(attrs.id)].apply(this, arguments);
    }

    // Initialize a generic Entity (used only in tests).
    return (new iD.Entity()).initialize(arguments);
};

iD.Entity.id = function(type) {
    return iD.Entity.id.fromOSM(type, iD.Entity.id.next[type]--);
};

iD.Entity.id.next = {node: -1, way: -1, relation: -1};

iD.Entity.id.fromOSM = function(type, id) {
    return type[0] + id;
};

iD.Entity.id.toOSM = function(id) {
    return id.slice(1);
};

iD.Entity.id.type = function(id) {
    return {'n': 'node', 'w': 'way', 'r': 'relation'}[id[0]];
};

// A function suitable for use as the second argument to d3.selection#data().
iD.Entity.key = function(entity) {
    return entity.id + 'v' + (entity.v || 0);
};

iD.Entity.prototype = {
    tags: {},

    initialize: function(sources) {
        for (var i = 0; i < sources.length; ++i) {
            var source = sources[i];
            for (var prop in source) {
                if (Object.prototype.hasOwnProperty.call(source, prop)) {
                    if (source[prop] === undefined) {
                        delete this[prop];
                    } else {
                        this[prop] = source[prop];
                    }
                }
            }
        }

        if (!this.id && this.type) {
            this.id = iD.Entity.id(this.type);
        }
        if (!this.hasOwnProperty('visible')) {
            this.visible = true;
        }

        if (iD.debug) {
            Object.freeze(this);
            Object.freeze(this.tags);

            if (this.loc) Object.freeze(this.loc);
            if (this.nodes) Object.freeze(this.nodes);
            if (this.members) Object.freeze(this.members);
        }

        return this;
    },

    copy: function() {
        // Returns an array so that we can support deep copying ways and relations.
        // The first array element will contain this.copy, followed by any descendants.
        return [iD.Entity(this, {id: undefined, user: undefined, version: undefined})];
    },

    osmId: function() {
        return iD.Entity.id.toOSM(this.id);
    },

    isNew: function() {
        return this.osmId() < 0;
    },

    update: function(attrs) {
        return iD.Entity(this, attrs, {v: 1 + (this.v || 0)});
    },

    mergeTags: function(tags) {
        var merged = _.clone(this.tags), changed = false;
        for (var k in tags) {
            var t1 = merged[k],
                t2 = tags[k];
            if (!t1) {
                changed = true;
                merged[k] = t2;
            } else if (t1 !== t2) {
                changed = true;
                merged[k] = _.union(t1.split(/;\s*/), t2.split(/;\s*/)).join(';');
            }
        }
        return changed ? this.update({tags: merged}) : this;
    },

    intersects: function(extent, resolver) {
        return this.extent(resolver).intersects(extent);
    },

    isUsed: function(resolver) {
        return _.without(Object.keys(this.tags), 'area').length > 0 ||
            resolver.parentRelations(this).length > 0;
    },

    hasInterestingTags: function() {
        return _.keys(this.tags).some(function(key) {
            return key !== 'attribution' &&
                key !== 'created_by' &&
                key !== 'source' &&
                key !== 'odbl' &&
                key.indexOf('tiger:') !== 0;
        });
    },

    isHighwayIntersection: function() {
        return false;
    },

    deprecatedTags: function() {
        var tags = _.pairs(this.tags);
        var deprecated = {};

        iD.data.deprecated.forEach(function(d) {
            var match = _.pairs(d.old)[0];
            tags.forEach(function(t) {
                if (t[0] === match[0] &&
                    (t[1] === match[1] || match[1] === '*')) {
                    deprecated[t[0]] = t[1];
                }
            });
        });

        return deprecated;
    }
};
iD.Way = iD.Entity.way = function iD_Way() {
    if (!(this instanceof iD_Way)) {
        return (new iD_Way()).initialize(arguments);
    } else if (arguments.length) {
        this.initialize(arguments);
    }
};

iD.Way.prototype = Object.create(iD.Entity.prototype);

_.extend(iD.Way.prototype, {
    type: 'way',
    nodes: [],

    copy: function(deep, resolver) {
        var copy = iD.Entity.prototype.copy.call(this);

        if (!deep || !resolver) {
            return copy;
        }

        var nodes = [],
            replacements = {},
            i, oldid, newid, child;

        for (i = 0; i < this.nodes.length; i++) {
            oldid = this.nodes[i];
            newid = replacements[oldid];
            if (!newid) {
                child = resolver.entity(oldid).copy();
                newid = replacements[oldid] = child[0].id;
                copy = copy.concat(child);
            }
            nodes.push(newid);
        }

        copy[0] = copy[0].update({nodes: nodes});
        return copy;
    },

    extent: function(resolver) {
        return resolver.transient(this, 'extent', function() {
            var extent = iD.geo.Extent();
            for (var i = 0; i < this.nodes.length; i++) {
                var node = resolver.hasEntity(this.nodes[i]);
                if (node) {
                    extent._extend(node.extent());
                }
            }
            return extent;
        });
    },

    first: function() {
        return this.nodes[0];
    },

    last: function() {
        return this.nodes[this.nodes.length - 1];
    },

    contains: function(node) {
        return this.nodes.indexOf(node) >= 0;
    },

    affix: function(node) {
        if (this.nodes[0] === node) return 'prefix';
        if (this.nodes[this.nodes.length - 1] === node) return 'suffix';
    },

    layer: function() {
        // explicit layer tag, clamp between -10, 10..
        if (this.tags.layer !== undefined) {
            return Math.max(-10, Math.min(+(this.tags.layer), 10));
        }

        // implied layer tag..
        if (this.tags.location === 'overground') return 1;
        if (this.tags.location === 'underground') return -1;
        if (this.tags.location === 'underwater') return -10;

        if (this.tags.power === 'line') return 10;
        if (this.tags.power === 'minor_line') return 10;
        if (this.tags.aerialway) return 10;
        if (this.tags.bridge) return 1;
        if (this.tags.cutting) return -1;
        if (this.tags.tunnel) return -1;
        if (this.tags.waterway) return -1;
        if (this.tags.man_made === 'pipeline') return -10;
        if (this.tags.boundary) return -10;
        return 0;
    },

    isOneWay: function() {
        // explicit oneway tag..
        if (['yes', '1', '-1'].indexOf(this.tags.oneway) !== -1) { return true; }
        if (['no', '0'].indexOf(this.tags.oneway) !== -1) { return false; }

        // implied oneway tag..
        for (var key in this.tags) {
            if (key in iD.oneWayTags && (this.tags[key] in iD.oneWayTags[key]))
                return true;
        }
        return false;
    },

    isClosed: function() {
        return this.nodes.length > 0 && this.first() === this.last();
    },

    isConvex: function(resolver) {
        if (!this.isClosed() || this.isDegenerate()) return null;

        var nodes = _.uniq(resolver.childNodes(this)),
            coords = _.pluck(nodes, 'loc'),
            curr = 0, prev = 0;

        for (var i = 0; i < coords.length; i++) {
            var o = coords[(i+1) % coords.length],
                a = coords[i],
                b = coords[(i+2) % coords.length],
                res = iD.geo.cross(o, a, b);

            curr = (res > 0) ? 1 : (res < 0) ? -1 : 0;
            if (curr === 0) {
                continue;
            } else if (prev && curr !== prev) {
                return false;
            }
            prev = curr;
        }
        return true;
    },

    isArea: function() {
        if (this.tags.area === 'yes')
            return true;
        if (!this.isClosed() || this.tags.area === 'no')
            return false;
        for (var key in this.tags)
            if (key in iD.areaKeys && !(this.tags[key] in iD.areaKeys[key]))
                return true;
        return false;
    },

    isDegenerate: function() {
        return _.uniq(this.nodes).length < (this.isArea() ? 3 : 2);
    },

    areAdjacent: function(n1, n2) {
        for (var i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i] === n1) {
                if (this.nodes[i - 1] === n2) return true;
                if (this.nodes[i + 1] === n2) return true;
            }
        }
        return false;
    },

    geometry: function(graph) {
        return graph.transient(this, 'geometry', function() {
            return this.isArea() ? 'area' : 'line';
        });
    },

    addNode: function(id, index) {
        var nodes = this.nodes.slice();
        nodes.splice(index === undefined ? nodes.length : index, 0, id);
        return this.update({nodes: nodes});
    },

    updateNode: function(id, index) {
        var nodes = this.nodes.slice();
        nodes.splice(index, 1, id);
        return this.update({nodes: nodes});
    },

    replaceNode: function(needle, replacement) {
        if (this.nodes.indexOf(needle) < 0)
            return this;

        var nodes = this.nodes.slice();
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i] === needle) {
                nodes[i] = replacement;
            }
        }
        return this.update({nodes: nodes});
    },

    removeNode: function(id) {
        var nodes = [];

        for (var i = 0; i < this.nodes.length; i++) {
            var node = this.nodes[i];
            if (node !== id && nodes[nodes.length - 1] !== node) {
                nodes.push(node);
            }
        }

        // Preserve circularity
        if (this.nodes.length > 1 && this.first() === id && this.last() === id && nodes[nodes.length - 1] !== nodes[0]) {
            nodes.push(nodes[0]);
        }

        return this.update({nodes: nodes});
    },

    asJXON: function(changeset_id) {
        var r = {
            way: {
                '@id': this.osmId(),
                '@version': this.version || 0,
                nd: _.map(this.nodes, function(id) {
                    return { keyAttributes: { ref: iD.Entity.id.toOSM(id) } };
                }),
                tag: _.map(this.tags, function(v, k) {
                    return { keyAttributes: { k: k, v: v } };
                })
            }
        };
        if (changeset_id) r.way['@changeset'] = changeset_id;
        return r;
    },

    asGeoJSON: function(resolver) {
        return resolver.transient(this, 'GeoJSON', function() {
            var coordinates = _.pluck(resolver.childNodes(this), 'loc');
            if (this.isArea() && this.isClosed()) {
                return {
                    type: 'Polygon',
                    coordinates: [coordinates]
                };
            } else {
                return {
                    type: 'LineString',
                    coordinates: coordinates
                };
            }
        });
    },

    area: function(resolver) {
        return resolver.transient(this, 'area', function() {
            var nodes = resolver.childNodes(this);

            var json = {
                type: 'Polygon',
                coordinates: [_.pluck(nodes, 'loc')]
            };

            if (!this.isClosed() && nodes.length) {
                json.coordinates[0].push(nodes[0].loc);
            }

            var area = d3.geo.area(json);

            // Heuristic for detecting counterclockwise winding order. Assumes
            // that OpenStreetMap polygons are not hemisphere-spanning.
            if (area > 2 * Math.PI) {
                json.coordinates[0] = json.coordinates[0].reverse();
                area = d3.geo.area(json);
            }

            return isNaN(area) ? 0 : area;
        });
    }
});
module.exports = iD.geo;
