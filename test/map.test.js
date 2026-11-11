// 本番のマップに置き間違いがないかの確認。`npm test` で実行
// マップを作り直したら、まずこれを通すこと
import assert from 'node:assert/strict';
import { FOUNDRY } from '../src/data/maps/foundry.js';
import { buildMap, floorAt, areaAt } from '../src/sim/map.js';
import { World, TICK } from '../src/sim/world.js';

const STEP_UP = 0.45, HALF = 0.35;

for (const def of [FOUNDRY]) {
  const map = buildMap(def);
  const [W, H] = map.size, [ox, oz] = map.origin;
  const at = (x, z) => floorAt(map, x, z);

  // ---- スポーンから全エリアへ歩いて行ける (0.45m までの段差は上れる、下りは自由) ----
  const reach = (sx, sz) => {
    const seen = new Uint8Array(W * H), idx = (x, z) => (Math.floor(z) - oz) * W + (Math.floor(x) - ox);
    const q = [idx(sx, sz)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), cx = i % W, cz = (i / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const j = nz * W + nx;
        if (seen[j] || map.heights[j] < 0 || map.heights[j] - map.heights[i] > STEP_UP) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return (x, z) => !!seen[idx(x, z)];
  };
  for (const side of ['attack', 'defense']) {
    assert.ok(map.spawns[side].length >= 5, `${side} のスポーン地点が 5 か所以上`);
    const s = map.spawns[side][0], ok = reach(s.x, s.z);
    for (const a of def.areas) {
      // エリアのどこか 1 マスに着ければよい (中に柱があっても構わない)
      let found = false;
      for (let z = a.z0; z < a.z1 && !found; z++) for (let x = a.x0; x < a.x1 && !found; x++) {
        if (areaAt(map, x + 0.5, z + 0.5) === a.name && ok(x, z)) found = true;
      }
      assert.ok(found, `${side} スポーンから「${a.name}」に行ける`);
    }
    // スポーン地点は床の上で、購入フェーズの範囲の中
    const zone = def.buyZones[side];
    for (const p of map.spawns[side]) {
      assert.equal(at(p.x, p.z), 0, `${side} スポーン (${p.x},${p.z}) が床の上`);
      assert.ok(p.x > zone[0] && p.x < zone[2] && p.z > zone[1] && p.z < zone[3], `${side} スポーンが購入範囲の中`);
    }
  }

  // ---- サイト ----
  assert.deepEqual(Object.keys(map.sites).sort(), ['A', 'B']);

  // ---- サイトまでの道のり: 防衛側は攻撃側より先に着ける。遠回り (ミッド経由だけ) になっていない ----
  const walk = (sx, sz) => { // 歩く距離 (マス数)。届かないマスは -1
    const dist = new Int32Array(W * H).fill(-1), q = [(Math.floor(sz) - oz) * W + (Math.floor(sx) - ox)];
    dist[q[0]] = 0;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], cx = i % W, cz = (i / W) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const j = nz * W + nx;
        if (dist[j] >= 0 || map.heights[j] < 0 || map.heights[j] - map.heights[i] > STEP_UP) continue;
        dist[j] = dist[i] + 1; q.push(j);
      }
    }
    return (site) => { // サイトの中で一番近いマスまで
      let best = Infinity;
      for (let z = site.min[1]; z < site.max[1]; z++) for (let x = site.min[0]; x < site.max[0]; x++) {
        const d = dist[(z - oz) * W + (x - ox)];
        if (d >= 0 && d < best) best = d;
      }
      return best;
    };
  };
  // スポーンの真ん中あたりから測る (端の地点だと A と B で不公平になる)
  const mid = (list) => list.reduce((b, p) => (Math.abs(p.x) < Math.abs(b.x) ? p : b));
  const atk = mid(map.spawns.attack), dfn = mid(map.spawns.defense);
  const fromAtk = walk(atk.x, atk.z), fromDef = walk(dfn.x, dfn.z);
  const routes = [];
  for (const name of ['A', 'B']) {
    const a = fromAtk(map.sites[name]), d = fromDef(map.sites[name]);
    routes.push(`${name}: 防衛 ${d}m / 攻撃 ${a}m`);
    assert.ok(d < a, `防衛側が ${name} サイトに先に着ける (防衛 ${d}m、攻撃 ${a}m)`);
    assert.ok(d <= 100, `防衛スポーンから ${name} サイトまでが遠すぎない (${d}m)`);
    assert.ok(a >= 90 && a <= 190, `攻撃スポーンから ${name} サイトまでの距離が妥当 (${a}m)`);
  }
  console.log('  サイトまでの道のり  ' + routes.join('、'));

  // ---- 遮蔽物は床の上に置かれている (建物にめり込んだり、宙に浮いたりしていない) ----
  for (const p of def.props) {
    const y = p.y || 0, floor = at(p.x, p.z);
    assert.ok(floor >= 0, `遮蔽物 (${p.x},${p.z}) が建物の中にある`);
    // 床に直接置くか、他の遮蔽物の上に積む
    const onFloor = Math.abs(floor - y) < 0.01;
    const onProp = def.props.some((q) => q !== p && Math.abs((q.y || 0) + q.h - y) < 0.01
      && Math.abs(q.x - p.x) < q.w / 2 && Math.abs(q.z - p.z) < q.d / 2);
    assert.ok(onFloor || onProp, `遮蔽物 (${p.x},${p.z}) の高さ ${y} が床 ${floor} と合わない`);
  }

  // ---- 射撃場の的は床の上に立ち、遮蔽物と重ならない。動く的は端まで動ける ----
  const blockedAt = (x, y, z) => def.props.some((p) => x + 0.3 > p.x - p.w / 2 && x - 0.3 < p.x + p.w / 2
    && z + 0.3 > p.z - p.d / 2 && z - 0.3 < p.z + p.d / 2 && y + 1.8 > (p.y || 0) && y < (p.y || 0) + p.h);
  for (const t of def.targets) {
    const y = t.y || 0;
    const spots = t.move ? [-1, -0.5, 0, 0.5, 1].map((k) => ({ ...t, [t.move.axis]: t[t.move.axis] + k * t.move.range })) : [t];
    for (const s of spots) {
      for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        assert.ok(Math.abs(at(s.x + dx, s.z + dz) - y) < 0.01, `的 (${t.x},${t.z}) の足元 (${s.x},${s.z}) が床 ${y} でない`);
      }
      assert.ok(!blockedAt(s.x, y, s.z), `的 (${t.x},${t.z}) が (${s.x},${s.z}) で遮蔽物と重なる`);
    }
  }

  // ---- 射撃場: 出現して床に立てる ----
  const w = new World(def, { seed: 1 });
  const p = w.addPlayer('me', def.rangeSpawn);
  const idle = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, fire: false, alt: false, reload: false, use: false, slot: null, yaw: 0, pitch: 0 };
  for (let i = 0; i < 40; i++) w.step(TICK, { me: [idle] }); // 入力が来ないと移動は進まない
  assert.ok(p.onGround && Math.abs(p.pos.y) < 1e-6, '射撃場のスポーンで床に立てる');
  assert.ok(at(def.rangeSpawn.x + HALF, def.rangeSpawn.z) === 0);

  console.log(`map: ${def.name} OK (エリア ${def.areas.length}、箱 ${map.boxes.length}、的 ${def.targets.length})`);
}
