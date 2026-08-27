import * as THREE from "three";
import { SUN_DIR, SURFACE_Y } from "./config.js";
import {
  createBubbleMaterial,
  createCausticDecalMaterial,
  createGodRayMaterial,
  createMoteMaterial,
  createSurfaceGlowMaterial,
  createVolumeDomeMaterial,
  createVolumeShaftMaterial,
  createSkyDomeMaterial,
  createWaterMaterial,
} from "./shaders.js";

const _sun = new THREE.Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).normalize();
const _toCam = new THREE.Vector3();
const _side = new THREE.Vector3();
const _face = new THREE.Vector3();
const _basis = new THREE.Matrix4();

function orientRay(mesh, camera) {
  _toCam.subVectors(camera.position, mesh.position);
  _side.crossVectors(_sun, _toCam);
  if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
  else _side.normalize();
  _face.crossVectors(_side, _sun).normalize();
  _basis.makeBasis(_side, _sun, _face);
  mesh.quaternion.setFromRotationMatrix(_basis);
}

export function createAtmosphere(scene, shared) {
  const group = new THREE.Group();
  group.name = "atmosphere";

  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 28), createSkyDomeMaterial(shared));
  sky.renderOrder = -4;
  sky.frustumCulled = false;
  group.add(sky);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(520, 48, 28), createVolumeDomeMaterial(shared));
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  group.add(dome);

  // Clip-space grid projected onto y = SURFACE_Y. No finite-plane bowl.
  const waterGeo = new THREE.PlaneGeometry(3.2, 3.2, 176, 176);
  const waterMat = createWaterMaterial(shared);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.frustumCulled = false;
  water.renderOrder = 4;
  water.matrixAutoUpdate = false;
  water.matrix.identity();
  group.add(water);
  const _viewProjInv = new THREE.Matrix4();

  const cubeRT = new THREE.WebGLCubeRenderTarget(128, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCam = new THREE.CubeCamera(0.6, 420, cubeRT);
  waterMat.uniforms.uEnv.value = cubeRT.texture;
  let envClock = 10;

  const glow = new THREE.Mesh(new THREE.CircleGeometry(48, 72), createSurfaceGlowMaterial(shared));
  glow.rotation.x = Math.PI / 2;
  glow.position.y = SURFACE_Y - 0.45;
  glow.visible = false;
  glow.frustumCulled = false;
  group.add(glow);

  const causticMat = createCausticDecalMaterial(shared);
  const causticGeo = new THREE.PlaneGeometry(140, 140, 1, 1);
  causticGeo.rotateX(-Math.PI / 2);
  const caustics = new THREE.Mesh(causticGeo, causticMat);
  caustics.position.set(4, -21.42, 8);
  caustics.renderOrder = 1;
  group.add(caustics);

  const rayMat = createGodRayMaterial(shared);
  const rays = [];
  const rayPlaces = [
    { x: -16, y: -8, z: 2, w: 18, h: 46 },
    { x: -11, y: -8, z: -6, w: 16, h: 48 },
    { x: -7, y: -7, z: 4, w: 14, h: 44 },
    { x: -6, y: -9, z: -14, w: 15, h: 48 },
    { x: 1.4, y: -10, z: -9, w: 11, h: 44 },
    { x: 3, y: -9, z: -16, w: 12, h: 46 },
    { x: 18, y: -9, z: -12, w: 16, h: 48 },
    { x: -20, y: -8, z: 8, w: 16, h: 46 },
    { x: 166, y: -22, z: -4, w: 16, h: 56 },
    { x: 180, y: -22, z: -16, w: 14, h: 56 },
    { x: 192, y: -22, z: 8, w: 16, h: 56 },
    { x: 154, y: -22, z: 12, w: 14, h: 54 },
    { x: 8, y: -28, z: -190, w: 18, h: 52 },
    { x: 22, y: -30, z: -200, w: 16, h: 50 },
    { x: -6, y: -29, z: -210, w: 14, h: 48 },
  ];
  for (const p of rayPlaces) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), rayMat);
    m.position.set(p.x, p.y, p.z);
    m.renderOrder = 2;
    group.add(m);
    rays.push(m);
  }
  const followRayOff = [
    { ox: -6, oz: -8, w: 9, h: 36 },
    { ox: 3, oz: -5, w: 8, h: 34 },
    { ox: 9, oz: -11, w: 8, h: 32 },
  ];
  const followRays = [];
  for (const p of followRayOff) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), rayMat);
    m.renderOrder = 2;
    group.add(m);
    rays.push(m);
    followRays.push({ mesh: m, ox: p.ox, oz: p.oz });
  }

  const shaftMat = createVolumeShaftMaterial(shared);
  const shafts = [];
  const shaftOff = [
    { ox: -3.5, oz: -1.2, rTop: 5.5, rBot: 15, h: 44 },
    { ox: 6.2, oz: -7.4, rTop: 4.2, rBot: 12, h: 40 },
    { ox: -9.0, oz: 5.5, rTop: 3.8, rBot: 11, h: 38 },
  ];
  for (const s of shaftOff) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(s.rTop, s.rBot, s.h, 22, 1, true), shaftMat);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
    shafts.push({ mesh, ox: s.ox, oz: s.oz, h: s.h });
  }

  const moteCount = 700;
  const motePos = new Float32Array(moteCount * 3);
  const moteVel = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 280;
    motePos[i * 3 + 1] = -2 - Math.random() * 72;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 220;
    moteVel[i * 3] = (Math.random() - 0.5) * 0.12;
    moteVel[i * 3 + 1] = 0.02 + Math.random() * 0.08;
    moteVel[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, createMoteMaterial(shared, 4));
  group.add(motes);

  const nearCount = 120;
  const nearPos = new Float32Array(nearCount * 3);
  const nearVel = new Float32Array(nearCount * 3);
  for (let i = 0; i < nearCount; i++) {
    nearPos[i * 3] = (Math.random() - 0.5) * 22;
    nearPos[i * 3 + 1] = (Math.random() - 0.5) * 16;
    nearPos[i * 3 + 2] = (Math.random() - 0.5) * 22;
    nearVel[i * 3] = (Math.random() - 0.5) * 0.18;
    nearVel[i * 3 + 1] = 0.04 + Math.random() * 0.1;
    nearVel[i * 3 + 2] = (Math.random() - 0.5) * 0.18;
  }
  const nearGeo = new THREE.BufferGeometry();
  nearGeo.setAttribute("position", new THREE.BufferAttribute(nearPos, 3));
  const nearMotes = new THREE.Points(nearGeo, createMoteMaterial(shared, 6));
  nearMotes.frustumCulled = false;
  group.add(nearMotes);

  const bubbleCount = 180;
  const bubblePos = new Float32Array(bubbleCount * 3);
  const bubbleVel = new Float32Array(bubbleCount);
  for (let i = 0; i < bubbleCount; i++) {
    bubblePos[i * 3] = (Math.random() - 0.5) * 240;
    bubblePos[i * 3 + 1] = -70 + Math.random() * 68;
    bubblePos[i * 3 + 2] = (Math.random() - 0.5) * 200;
    bubbleVel[i] = 0.45 + Math.random() * 0.85;
  }
  const bubbleGeo = new THREE.BufferGeometry();
  bubbleGeo.setAttribute("position", new THREE.BufferAttribute(bubblePos, 3));
  const bubbles = new THREE.Points(bubbleGeo, createBubbleMaterial(shared, 6));
  group.add(bubbles);

  const swimCount = 96;
  const swimPos = new Float32Array(swimCount * 3);
  const swimVel = new Float32Array(swimCount);
  const swimLife = new Float32Array(swimCount);
  for (let i = 0; i < swimCount; i++) {
    swimPos[i * 3] = 0;
    swimPos[i * 3 + 1] = -80;
    swimPos[i * 3 + 2] = 0;
    swimVel[i] = 0.55 + Math.random() * 0.7;
    swimLife[i] = 0;
  }
  const swimGeo = new THREE.BufferGeometry();
  swimGeo.setAttribute("position", new THREE.BufferAttribute(swimPos, 3));
  const swimBubbles = new THREE.Points(swimGeo, createBubbleMaterial(shared, 8));
  swimBubbles.frustumCulled = false;
  group.add(swimBubbles);
  let swimCursor = 0;
  let swimAcc = 0;
  let nearSeeded = false;
  let particleTick = 0;

  scene.add(group);

  const _sunAlign = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  return {
    group,
    water,
    rays,
    envMap: cubeRT.texture,
    update(dt, camera, renderer, scene, player) {
      sky.position.copy(camera.position);
      dome.position.copy(camera.position);
      const surfaced = camera.position.y > SURFACE_Y - 0.25;
      const insideBase = !!(player && player.insideBase);
      const deepCave = camera.position.y < -110;
      const deepVoid = camera.position.y < -55;
      if (shared.uAboveWorld) shared.uAboveWorld.value = surfaced ? 1 : 0;
      sky.visible = surfaced;
      dome.visible = !surfaced && !insideBase && !deepCave && !deepVoid;
      camera.updateMatrixWorld();
      _viewProjInv.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
      waterMat.uniforms.uViewProjInv.value.copy(_viewProjInv);
      if (renderer) renderer.getDrawingBufferSize(waterMat.uniforms.uRes.value);
      envClock += dt;
      const wantEnv = camera.position.y > -8;
      if (renderer && scene && wantEnv && envClock > 0.4) {
        envClock = 0;
        water.visible = false;
        glow.visible = false;
        caustics.visible = false;
        motes.visible = false;
        nearMotes.visible = false;
        bubbles.visible = false;
        swimBubbles.visible = false;
        for (const r of rays) r.visible = false;
        for (const s of shafts) s.mesh.visible = false;
        cubeCam.position.set(camera.position.x, Math.max(3.2, camera.position.y + 1.4), camera.position.z);
        cubeCam.update(renderer, scene);
        water.visible = true;
        motes.visible = true;
        nearMotes.visible = true;
        bubbles.visible = true;
        swimBubbles.visible = true;
        caustics.visible = true;
        for (const r of rays) r.visible = true;
        for (const s of shafts) s.mesh.visible = false;
        waterMat.uniforms.uHasEnv.value = 1;
      }

      particleTick++;
      const runParticles = particleTick % 2 === 0;
      const mp = motes.geometry.attributes.position.array;
      if (runParticles) {
        const step = dt * 2;
        for (let i = 0; i < moteCount; i++) {
          mp[i * 3] += moteVel[i * 3] * step;
          mp[i * 3 + 1] += moteVel[i * 3 + 1] * step;
          mp[i * 3 + 2] += moteVel[i * 3 + 2] * step;
          if (mp[i * 3 + 1] > -1) mp[i * 3 + 1] = -70;
          const dx = mp[i * 3] - camera.position.x;
          const dz = mp[i * 3 + 2] - camera.position.z;
          if (dx > 140) mp[i * 3] -= 280;
          if (dx < -140) mp[i * 3] += 280;
          if (dz > 120) mp[i * 3 + 2] -= 240;
          if (dz < -120) mp[i * 3 + 2] += 240;
        }
        motes.geometry.attributes.position.needsUpdate = true;
      }

      const np = nearMotes.geometry.attributes.position.array;
      if (!nearSeeded) {
        nearSeeded = true;
        for (let i = 0; i < nearCount; i++) {
          np[i * 3] = camera.position.x + (Math.random() - 0.5) * 22;
          np[i * 3 + 1] = camera.position.y + (Math.random() - 0.5) * 16;
          np[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 22;
        }
      }
      for (let i = 0; i < nearCount; i++) {
        np[i * 3] += nearVel[i * 3] * dt;
        np[i * 3 + 1] += nearVel[i * 3 + 1] * dt;
        np[i * 3 + 2] += nearVel[i * 3 + 2] * dt;
        let dx = np[i * 3] - camera.position.x;
        let dy = np[i * 3 + 1] - camera.position.y;
        let dz = np[i * 3 + 2] - camera.position.z;
        if (dx > 11) np[i * 3] -= 22;
        if (dx < -11) np[i * 3] += 22;
        if (dy > 8) np[i * 3 + 1] -= 16;
        if (dy < -8) np[i * 3 + 1] += 16;
        if (dz > 11) np[i * 3 + 2] -= 22;
        if (dz < -11) np[i * 3 + 2] += 22;
      }
      nearMotes.geometry.attributes.position.needsUpdate = true;

      const bp = bubbles.geometry.attributes.position.array;
      for (let i = 0; i < bubbleCount; i++) {
        bp[i * 3 + 1] += bubbleVel[i] * dt;
        bp[i * 3] += Math.sin(bp[i * 3 + 1] * 0.4 + i) * 0.08 * dt;
        if (bp[i * 3 + 1] > -0.4) {
          bp[i * 3] = camera.position.x + (Math.random() - 0.5) * 50;
          bp[i * 3 + 1] = camera.position.y - 8 - Math.random() * 28;
          bp[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 50;
        }
      }
      bubbles.geometry.attributes.position.needsUpdate = true;

      const speed = player && player.velocity ? player.velocity.length() : 0;
      const below = camera.position.y < SURFACE_Y - 0.25;
      swimAcc += dt * (below ? 1.6 + speed * 1.8 : 0);
      const sp = swimBubbles.geometry.attributes.position.array;
      while (swimAcc > 0.045) {
        swimAcc -= 0.045;
        const i = swimCursor++ % swimCount;
        const side = (Math.random() - 0.5) * 0.55;
        const back = 0.35 + Math.random() * 0.55;
        const down = 0.25 + Math.random() * 0.45;
        camera.getWorldDirection(_toCam);
        _toCam.normalize();
        _side.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        sp[i * 3] = camera.position.x - _toCam.x * back + _side.x * side;
        sp[i * 3 + 1] = camera.position.y - down;
        sp[i * 3 + 2] = camera.position.z - _toCam.z * back + _side.z * side;
        swimVel[i] = 0.55 + Math.random() * 0.85 + speed * 0.04;
        swimLife[i] = 1;
      }
      for (let i = 0; i < swimCount; i++) {
        if (swimLife[i] <= 0) continue;
        sp[i * 3 + 1] += swimVel[i] * dt;
        sp[i * 3] += Math.sin(sp[i * 3 + 1] * 3.2 + i) * 0.12 * dt;
        if (sp[i * 3 + 1] > SURFACE_Y - 0.2 || sp[i * 3 + 1] > camera.position.y + 10) {
          swimLife[i] = 0;
          sp[i * 3 + 1] = -90;
        }
      }
      swimBubbles.geometry.attributes.position.needsUpdate = true;

      const hideVolumetrics = camera.position.y > SURFACE_Y - 0.4;
      for (const r of rays) {
        r.visible = !hideVolumetrics;
        if (!hideVolumetrics) orientRay(r, camera);
      }
      for (const f of followRays) {
        f.mesh.position.set(camera.position.x + f.ox, Math.min(-4, camera.position.y * 0.25 - 5), camera.position.z + f.oz);
      }

      for (const s of shafts) s.mesh.visible = false;

      // Additive 48 m disc was the painted bowl. Sun lives in the water shader.
      glow.visible = false;

      caustics.position.x = camera.position.x * 0.72 + 0.6;
      caustics.position.y = -21.42;
      caustics.position.z = camera.position.z * 0.62 + 1.4;
    },
  };
}

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0x6ec8c4, 0xa07a42, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d4, 2.85);
  sun.position.set(-62, 92, 48);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  sun.target.position.set(0, -20, -10);

  const fill = new THREE.DirectionalLight(0x3aa8b0, 0.22);
  fill.position.set(30, -6, -40);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight(0xe8be70, 0.28);
  bounce.position.set(8, -30, 20);
  scene.add(bounce);

  const heroWarm = new THREE.PointLight(0xffd089, 2.1, 28, 1.45);
  heroWarm.position.set(5.2, -14.2, 11.5);
  scene.add(heroWarm);

  const diveFill = new THREE.PointLight(0xc8fff4, 0.72, 18, 1.8);
  diveFill.position.set(0, -8, 0);
  scene.add(diveFill);

  const kelpFill = new THREE.PointLight(0xffb018, 3.4, 48, 1.32);
  kelpFill.position.set(176, -38, -6);
  scene.add(kelpFill);

  return { hemi, sun, fill, kelpFill, heroWarm, diveFill };
}
