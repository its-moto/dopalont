import { lerp } from '../core/math.js';

// DESIGN.md §4.5
export const RUN_SPEED = 6.75;
export const WALK_SPEED = 3.8;
export const CROUCH_SPEED = 2.9;
const GRAVITY = 22;
const JUMP_V = Math.sqrt(2 * GRAVITY * 1.1); // 高さ約 1.1m
const GROUND_ACCEL = 70; // 加減速が速い = 止まるとすぐ精度が戻る
const AIR_ACCEL = 12;
const HALF = 0.35;       // 当たり判定の半幅
const H_STAND = 1.8, H_CROUCH = 1.25;
const EYE_STAND = 1.62, EYE_CROUCH = 1.05;
const STEP_UP = 0.45;    // この高さまでの段差は自動で乗り越える
const STEP_DIST = 2.4;   // 足音の間隔 (m)
const EPS = 1e-4;

export const bodyHeight = (p) => lerp(H_STAND, H_CROUCH, p.crouch);
export const eyeHeight = (p) => lerp(EYE_STAND, EYE_CROUCH, p.crouch);

function overlap(boxes, x, y, z, h) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (x + HALF > b.min[0] && x - HALF < b.max[0] &&
        y + h > b.min[1] && y < b.max[1] &&
        z + HALF > b.min[2] && z - HALF < b.max[2]) return b;
  }
  return null;
}

/** 水平 1 軸ぶん動かす。ぶつかったら段差を試し、だめなら壁に沿って止める */
function moveAxis(boxes, p, axis, delta, h) {
  const pos = p.pos;
  const old = pos[axis];
  pos[axis] = old + delta;
  const b = overlap(boxes, pos.x, pos.y, pos.z, h);
  if (!b) return;
  if (p.onGround && b.max[1] - pos.y <= STEP_UP && !overlap(boxes, pos.x, b.max[1] + EPS, pos.z, h)) {
    pos.y = b.max[1] + EPS;
    return;
  }
  const i = axis === 'x' ? 0 : 2;
  pos[axis] = delta > 0 ? b.min[i] - HALF - EPS : b.max[i] + HALF + EPS;
  if (overlap(boxes, pos.x, pos.y, pos.z, h)) pos[axis] = old;
  p.vel[axis] = 0;
}

export function stepMovement(world, p, inp, dt) {
  const boxes = world.boxes;
  p.yaw = inp.yaw;
  p.pitch = inp.pitch;

  const crouchTarget = inp.crouch ? 1 : 0;
  p.crouch += Math.max(-dt * 8, Math.min(dt * 8, crouchTarget - p.crouch));
  const h = bodyHeight(p);

  // 入力方向 (yaw=0 で -Z を向く)
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  let wx = -sy * inp.mz + cy * inp.mx;
  let wz = -cy * inp.mz - sy * inp.mx;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  let max = p.crouch > 0.5 ? CROUCH_SPEED : inp.walk ? WALK_SPEED : RUN_SPEED;
  max *= p.moveMul;

  const accel = (p.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt;
  if (p.onGround || wl > 0) {
    const dx = wx * max - p.vel.x, dz = wz * max - p.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl <= accel) { p.vel.x = wx * max; p.vel.z = wz * max; }
    else { p.vel.x += (dx / dl) * accel; p.vel.z += (dz / dl) * accel; }
  }

  if (inp.jump && p.onGround) {
    p.vel.y = JUMP_V;
    p.onGround = false;
    world.emit('jump', { playerId: p.id });
  }
  p.vel.y -= GRAVITY * dt;

  moveAxis(boxes, p, 'x', p.vel.x * dt, h);
  moveAxis(boxes, p, 'z', p.vel.z * dt, h);

  // 垂直
  const wasGround = p.onGround, vy = p.vel.y;
  p.pos.y += vy * dt;
  const b = overlap(boxes, p.pos.x, p.pos.y, p.pos.z, h);
  if (b) {
    if (vy <= 0) {
      p.pos.y = b.max[1];
      p.onGround = true;
      p.groundMat = b.mat;
      if (!wasGround && vy < -5.5) world.emit('land', { playerId: p.id, mat: b.mat });
    } else {
      p.pos.y = b.min[1] - h - EPS;
    }
    p.vel.y = 0;
  } else {
    p.onGround = false;
  }

  // 足音: 走っている時だけ
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround && speed > WALK_SPEED + 0.4) {
    p.stepDist += speed * dt;
    if (p.stepDist >= STEP_DIST) {
      p.stepDist = 0;
      world.emit('footstep', { playerId: p.id, mat: p.groundMat });
    }
  } else if (speed < 0.5) {
    p.stepDist = STEP_DIST * 0.6; // 動き出しの 1 歩目を早めに鳴らす
  }
}
