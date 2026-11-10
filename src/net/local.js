import { World, TICK } from '../sim/world.js';

/**
 * セッション = 「自分から見たゲーム」。Game (描画・音・HUD) はこの形だけを見る
 *   mode: 'range' | 'net'      world / me / myId      events: この更新で起きたこと
 *   remotes: 他プレイヤーの表示用の状態      roster: 名前・チーム・戦績
 *   alpha: tick 間の補間係数      stepOff / viewOffset: カメラをなめらかにするための補正
 *
 * LocalSession は射撃場 (1 人、通信なし)
 */
export class LocalSession {
  constructor(mapDef, name) {
    this.mode = 'range';
    this.isHost = true;
    this.myId = 'me';
    this.world = new World(mapDef, { seed: (Math.random() * 1e9) | 0, infiniteReserve: true });
    this.me = this.world.addPlayer(this.myId, { ...mapDef.rangeSpawn, name });
    this.roster = new Map([[this.myId, { id: this.myId, name, team: null, kills: 0, deaths: 0 }]]);
    this.remotes = [];
    this.events = [];
    this.acc = 0; this.alpha = 0; this.stepOff = 0;
    this.viewOffset = { x: 0, y: 0, z: 0 };
  }

  update(dt, input) {
    const { world, me } = this;
    this.events.length = 0;
    this.acc += dt;
    while (this.acc >= TICK) {
      const wasGround = me.onGround, y0 = me.pos.y;
      world.savePrev();
      world.step(TICK, { [this.myId]: [input.sample()] });
      input.consumeEdges();
      if (wasGround && me.onGround && Math.abs(me.pos.y - y0) > 0.02) this.stepOff -= me.pos.y - y0;
      this.acc -= TICK;
    }
    this.alpha = this.acc / TICK;
    for (const e of world.drainEvents()) this.events.push(e);
  }
}
