import { World, TICK } from '../sim/world.js';
import { setSlot } from '../sim/round.js';
import { WEAPONS } from '../data/weapons.js';
import { RULES } from '../data/rules.js';

/**
 * セッション = 「自分から見たゲーム」。Game (描画・音・HUD) はこの形だけを見る
 *   mode: 'range' | 'net'      world / me / myId      events: この更新で起きたこと
 *   remotes: 他プレイヤーの表示用の状態      roster: 名前・チーム・戦績
 *   alpha: tick 間の補間係数      stepOff / viewOffset: カメラをなめらかにするための補正
 *
 * LocalSession は射撃場 (1 人、通信なし)
 */
export class LocalSession {
  constructor(mapDef, name, agent = 'gale') {
    this.mode = 'range';
    this.isHost = true;
    this.myId = 'me';
    this.world = new World(mapDef, { seed: (Math.random() * 1e9) | 0, infiniteReserve: true });
    this.me = this.world.addPlayer(this.myId, { ...mapDef.rangeSpawn, name, agent });
    this.roster = new Map([[this.myId, { id: this.myId, name, team: null, agent, kills: 0, deaths: 0 }]]);
    this.ents = this.world.ents;
    this.remotes = [];
    this.events = [];
    this.acc = 0; this.alpha = 0; this.stepOff = 0;
    this.viewOffset = { x: 0, y: 0, z: 0 };
    this.round = null;
  }

  /** 射撃場ではどの武器も無料で試せる */
  buy(item) {
    const def = WEAPONS[item], armor = RULES.armor[item];
    if (armor) this.me.armor = armor.value;
    else if (def && def.slot !== 'melee') setSlot(this.me, def.slot, item);
  }

  sell() {}

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
    this.ents = world.marks.length ? world.ents.concat(world.marks) : world.ents;
  }
}
