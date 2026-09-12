import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNearbyRepo } from '../public/city/nearby-repo.js';
const here = {x:0,z:0}, forward = {x:0,z:-1};
const a = {building:{repo:{name:'ahead'}},x:0,z:-8,half:2};
const b = {building:{repo:{name:'beside'}},x:7,z:-5,half:2};
test('nearby discovery uses facade distance and excludes far or rear buildings',()=> {
 assert.equal(pickNearbyRepo([a,b],here,forward).building,a.building);
 assert.equal(pickNearbyRepo([{...a,z:8}],here,forward),null);
 assert.equal(pickNearbyRepo([{...a,z:-20}],here,forward),null);
 assert.equal(pickNearbyRepo([{...a,z:-14,half:4}],here,forward).distance,10);
});
test('aimed repo takes priority within reach, and current target resists small changes',()=> {
 assert.equal(pickNearbyRepo([a,b],here,forward,null,12,b.building).building,b.building);
 const neighbor={...a,building:{},x:0.1};
 assert.equal(pickNearbyRepo([a,neighbor],here,forward,neighbor.building).building,neighbor.building);
 assert.equal(pickNearbyRepo([{...a,z:-30},b],here,forward,null,12,a.building).building,b.building);
});
