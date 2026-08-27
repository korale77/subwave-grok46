import * as THREE from "three";
import { clamp } from "./math.js";
import { DASH_SPEED, O2_MAX, SURFACE_Y, SWIM_SPEED, VERTICAL_SPEED } from "./config.js";
import { interiorCeilingAt, interiorFloorAt, isInsideBase, nearestBaseEntry, resolveSeabaseCollision } from "./seabase.js";

export function createPlayer(camera, canvas, heightAt) {
  const keys = new Set();
  const vel = new THREE.Vector3();
  const wish = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  let yaw = 0.18;
  let pitch = -0.16;
  let locked = false;
  let o2 = O2_MAX;
  let capture = false;
  let guided = false;
  let bobPhase = 0;
  let time = 0;

  camera.rotation.order = "YXZ";

  function applyLook() {
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
  }

  function releasePointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
    locked = false;
    document.body.classList.remove("locked");
  }

  function onMouse(e) {
    if (!locked || capture || guided) return;
    yaw -= e.movementX * 0.00205;
    pitch -= e.movementY * 0.00205;
    pitch = clamp(pitch, -1.42, 1.42);
  }

  function onKey(e, down) {
    if (guided || capture) {
      keys.clear();
      if (down && ["Space", "KeyC", "ControlLeft", "ControlRight"].includes(e.code)) e.preventDefault();
      return;
    }
    if (down) keys.add(e.code);
    else keys.delete(e.code);
    if (["Space", "KeyC", "ControlLeft", "ControlRight"].includes(e.code)) e.preventDefault();
  }

  canvas.addEventListener("click", (e) => {
    if (capture || guided) {
      e.preventDefault();
      return;
    }
    canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    if ((guided || capture) && document.pointerLockElement) {
      document.exitPointerLock();
      locked = false;
      document.body.classList.remove("locked");
      return;
    }
    locked = document.pointerLockElement === canvas;
    document.body.classList.toggle("locked", locked);
  });
  document.addEventListener("mousemove", onMouse);
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    keys.clear();
    if (guided) releasePointerLock();
  });

  applyLook();

  const player = {
    o2,
    insideBase: false,
    entryHint: null,
    get guided() {
      return guided;
    },
    get oxygen() {
      return o2;
    },
    get heading() {
      let h = ((-yaw * 180) / Math.PI) % 360;
      if (h < 0) h += 360;
      return h;
    },
    get depth() {
      return Math.max(0, SURFACE_Y - camera.position.y);
    },
    get velocity() {
      return vel;
    },
    setCapturePose(pos, target) {
      capture = true;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(target[0], target[1], target[2]);
      yaw = camera.rotation.y;
      pitch = camera.rotation.x;
    },
    warpTo(pos, target) {
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(target[0], target[1], target[2]);
      yaw = camera.rotation.y;
      pitch = camera.rotation.x;
      vel.set(0, 0, 0);
    },
    syncFromCamera() {
      yaw = camera.rotation.y;
      pitch = camera.rotation.x;
    },
    setGuided(on) {
      guided = !!on;
      keys.clear();
      vel.set(0, 0, 0);
      player.entryHint = null;
      if (guided) {
        o2 = O2_MAX;
        releasePointerLock();
      }
    },
    update(dt) {
      time += dt;
      const inside = isInsideBase(camera.position.x, camera.position.y, camera.position.z);
      player.insideBase = inside;
      if (capture || guided) {
        if (guided) {
          o2 = O2_MAX;
          player.entryHint = null;
          if (document.pointerLockElement) releasePointerLock();
          return;
        }
        if (inside || camera.position.y >= SURFACE_Y - 0.15) o2 = Math.min(O2_MAX, o2 + dt * 8);
        else o2 = Math.max(8, o2 - dt * 0.15);
        return;
      }

      camera.getWorldDirection(forward);
      right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      wish.set(0, 0, 0);
      if (keys.has("KeyW")) wish.add(forward);
      if (keys.has("KeyS")) wish.sub(forward);
      if (keys.has("KeyD")) wish.add(right);
      if (keys.has("KeyA")) wish.sub(right);
      if (keys.has("Space")) wish.y += 1;
      if (keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight")) wish.y -= 1;

      const dash = keys.has("ShiftLeft") || keys.has("ShiftRight");
      const speed = dash ? DASH_SPEED : SWIM_SPEED;
      if (wish.lengthSq() > 0) {
        wish.normalize();
        const horiz = new THREE.Vector3(wish.x, 0, wish.z);
        const lookH = new THREE.Vector3(forward.x, 0, forward.z);
        // pitch-relative WASD already in `forward`; extra world vertical from Space/Ctrl
        if (keys.has("Space") || keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight")) {
          wish.y = THREE.MathUtils.clamp(wish.y, -1, 1);
        }
        vel.lerp(wish.multiplyScalar(speed), 1 - Math.exp(-4.8 * dt));
        if (horiz.lengthSq() > 0 && lookH.lengthSq() > 0) {
          /* keep intent */
        }
      } else {
        vel.multiplyScalar(Math.exp(-2.6 * dt));
      }

      if (keys.has("Space") && !keys.has("KeyW") && !keys.has("KeyS")) {
        vel.y = THREE.MathUtils.damp(vel.y, VERTICAL_SPEED, 6, dt);
      }
      if ((keys.has("KeyC") || keys.has("ControlLeft") || keys.has("ControlRight")) && !keys.has("KeyW")) {
        vel.y = THREE.MathUtils.damp(vel.y, -VERTICAL_SPEED, 6, dt);
      }

      camera.position.addScaledVector(vel, dt);
      resolveSeabaseCollision(camera.position);
      const insideNow = isInsideBase(camera.position.x, camera.position.y, camera.position.z);
      player.insideBase = insideNow;

      const ground = heightAt(camera.position.x, camera.position.y, camera.position.z) + 1.15;
      const deck = interiorFloorAt(camera.position.x, camera.position.z);
      let floor = ground;
      if (deck != null && camera.position.y > deck + 0.18) {
        floor = Math.max(ground, deck + 1.48);
      }
      if (camera.position.y < floor) {
        camera.position.y = floor;
        vel.y = Math.max(vel.y, 0);
      }
      if (insideNow) {
        const ceil = interiorCeilingAt(camera.position.x, camera.position.z);
        if (ceil != null && camera.position.y > ceil - 0.32) {
          camera.position.y = ceil - 0.32;
          vel.y = Math.min(vel.y, 0);
        }
      }
      const onLand = floor > SURFACE_Y + 0.35;
      const maxSwimY = SURFACE_Y + 3.8;
      if (!onLand && camera.position.y > maxSwimY) {
        camera.position.y = maxSwimY;
        vel.y = Math.min(vel.y, 0);
      }

      if (insideNow || camera.position.y >= SURFACE_Y - 0.2) o2 = Math.min(O2_MAX, o2 + dt * 9);
      else o2 = Math.max(0, o2 - dt);

      const hint = nearestBaseEntry(camera.position.x, camera.position.y, camera.position.z);
      player.entryHint = hint ? hint.label : null;

      applyLook();

      const spd = vel.length();
      bobPhase += dt * (1.25 + spd * 0.32);
      const bob = Math.sin(bobPhase) * Math.min(spd, 8) * 0.011;
      const sway = Math.cos(bobPhase * 0.5) * Math.min(spd, 8) * 0.007;
      const idle = Math.sin(time * 0.32) * 0.008 + Math.sin(time * 0.71) * 0.004;
      const strafe = keys.has("KeyD") ? 1 : keys.has("KeyA") ? -1 : 0;
      camera.rotation.z = strafe * 0.055 + sway * 0.45 + idle;
      camera.rotation.x = pitch + bob * 0.42 + Math.sin(time * 0.21) * 0.006;

      const targetFov = dash ? 76 : 66;
      if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-5.2 * dt));
        camera.updateProjectionMatrix();
      }
    },
  };
  return player;
}
