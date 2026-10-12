/* Knockout Arena — the ring, hall, lights, instanced animated crowd, jumbotron */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const T = THREE;

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new T.CanvasTexture(c);
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.userData = { canvas: c, ctx: g };
    return t;
  }

  const FONT = "'Bebas Neue', Impact, 'Arial Narrow Bold', 'Arial Black', sans-serif";

  function drawMat(g, w, h) {
    g.fillStyle = '#7a1018'; g.fillRect(0, 0, w, h);                 // apron
    const m = Math.round(w * 0.074);                                   // 0.55m margin of 7.4m
    g.fillStyle = '#183c70'; g.fillRect(m, m, w - 2 * m, h - 2 * m);  // canvas
    // faint weave / wear
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.035) + ')';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.05) + ')';
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    // border band inside the ropes
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 10;
    g.strokeRect(m + 36, m + 36, w - 2 * m - 72, h - 2 * m - 72);
    // centre logo
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(Math.PI);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath(); g.arc(0, 0, w * 0.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 8;
    g.beginPath(); g.arc(0, 0, w * 0.2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#e8b923'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 ' + Math.round(w * 0.2) + 'px ' + FONT;
    g.fillText('KO', 0, -w * 0.015);
    g.fillStyle = '#ffffff'; g.font = '700 ' + Math.round(w * 0.05) + 'px ' + FONT;
    g.fillText('KNOCKOUT ARENA', 0, w * 0.1);
    g.restore();
    // corner marks
    const cols = ['#c1121f', '#1e5fd6', '#f4f4f4', '#f4f4f4'];
    const cs = [[m, m], [w - m, m], [m, h - m], [w - m, h - m]];
    cs.forEach((c, i) => {
      g.fillStyle = cols[i]; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(c[0], c[1]);
      g.lineTo(c[0] + (c[0] < w / 2 ? 90 : -90), c[1]); g.lineTo(c[0], c[1] + (c[1] < h / 2 ? 90 : -90)); g.closePath(); g.fill();
      g.globalAlpha = 1;
    });
  }

  function drawBanner(g, w, h, text, bg, fg) {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, bg); grd.addColorStop(1, BX.shade(bg, -0.45));
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 ' + Math.round(h * 0.62) + 'px ' + FONT;
    g.fillText(text, w / 2, h / 2 + 2);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, w, h * 0.08);
  }

  function glowTex() {
    return canvasTex(64, 64, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }

  function build(scene, quality) {
    const arena = { group: new T.Group(), quality };
    const G = arena.group;
    scene.add(G);
    const disposables = [];
    const own = (o) => { disposables.push(o); return o; };

    scene.background = new T.Color(0x04050a);
    scene.fog = new T.FogExp2(0x04050a, 0.034);

    /* ---------------- lights ---------------- */
    const hemi = new T.HemisphereLight(0x8fa4d0, 0x221a14, 0.55);
    G.add(hemi);
    const key = new T.SpotLight(0xfff1dc, 1.55, 0, 0.62, 0.55, 1);
    key.position.set(0.6, 9.5, 1.2);
    key.target.position.set(0, 0, 0);
    key.castShadow = quality !== 'low';
    const sh = quality === 'high' ? 2048 : 1024;
    key.shadow.mapSize.set(sh, sh);
    key.shadow.camera.near = 4; key.shadow.camera.far = 16;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 3;
    G.add(key); G.add(key.target);
    const fillA = new T.PointLight(0xff3b30, 0.55, 14, 1.4); fillA.position.set(-5, 3, -5); G.add(fillA);
    const fillB = new T.PointLight(0x2f7bff, 0.55, 14, 1.4); fillB.position.set(5, 3, 5); G.add(fillB);
    const fillC = new T.PointLight(0xffffff, 0.35, 12, 1.4); fillC.position.set(5, 3, -5); G.add(fillC);
    arena.lights = { hemi, key, fillA, fillB, fillC };

    /* ---------------- hall floor ---------------- */
    const floorTex = own(canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#0e1016'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1800; i++) { g.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.03 + ')'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
    }, true));
    floorTex.repeat.set(10, 10);
    const hall = new T.Mesh(own(new T.PlaneGeometry(80, 80)), own(new T.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.2 })));
    hall.rotation.x = -Math.PI / 2; hall.position.y = -1.0; hall.receiveShadow = true;
    G.add(hall);

    /* ---------------- ring ---------------- */
    const matTex = own(canvasTex(1024, 1024, drawMat));
    const skirtTex = own(canvasTex(1480, 200, (g, w, h) => drawBanner(g, w, h, 'KNOCKOUT ARENA', '#9b111e', '#ffffff')));
    const sideMat = own(new T.MeshStandardMaterial({ map: skirtTex, roughness: 0.8 }));
    const topMat = own(new T.MeshStandardMaterial({ map: matTex, roughness: 0.95 }));
    const botMat = own(new T.MeshStandardMaterial({ color: 0x111111 }));
    const platform = new T.Mesh(own(new T.BoxGeometry(7.4, 1.0, 7.4)), [sideMat, sideMat, topMat, botMat, sideMat, sideMat]);
    platform.position.y = -0.5;
    platform.receiveShadow = true;
    G.add(platform);
    arena.floor = platform;

    const chrome = own(new T.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.4, metalness: 0.25, emissive: 0x20242b }));
    const padCols = [0xc1121f, 0x1e5fd6, 0xf2f2f2, 0xf2f2f2];
    const P = 3.02;
    const corners = [[-P, -P], [P, -P], [-P, P], [P, P]];
    corners.forEach((c, i) => {
      const post = new T.Mesh(own(new T.CylinderGeometry(0.07, 0.07, 1.62, 14)), chrome);
      post.position.set(c[0], 0.81, c[1]); post.castShadow = true; G.add(post);
      const pad = new T.Mesh(own(new T.BoxGeometry(0.34, 1.0, 0.34)), own(new T.MeshStandardMaterial({ color: padCols[i], roughness: 0.7 })));
      pad.position.set(c[0] * 0.985, 0.78, c[1] * 0.985); pad.castShadow = true; G.add(pad);
      const cap = new T.Mesh(own(new T.SphereGeometry(0.085, 12, 8)), chrome);
      cap.position.set(c[0], 1.64, c[1]); G.add(cap);
    });
    const ropeCols = [0xf2f2f2, 0xc1121f, 0x1e5fd6];
    const ropeY = [0.55, 0.95, 1.35];
    arena.ropes = [];
    const ropeG = own(new T.CylinderGeometry(0.026, 0.026, 2 * P, 8));
    ropeY.forEach((y, ri) => {
      const mat = own(new T.MeshStandardMaterial({ color: ropeCols[ri], roughness: 0.55 }));
      for (let s = 0; s < 4; s++) {
        const rope = new T.Mesh(ropeG, mat);
        const horizontal = s < 2;
        rope.position.set(horizontal ? 0 : (s === 2 ? -P : P), y, horizontal ? (s === 0 ? -P : P) : 0);
        rope.rotation.z = horizontal ? Math.PI / 2 : 0;
        rope.rotation.x = horizontal ? 0 : Math.PI / 2;
        if (!horizontal) rope.rotation.set(Math.PI / 2, 0, 0);
        if (horizontal) rope.rotation.set(0, 0, Math.PI / 2);
        rope.castShadow = quality === 'high';
        rope.userData = { baseY: y, side: s, kick: 0 };
        G.add(rope);
        arena.ropes.push(rope);
      }
    });
    // steps / stool decoration: two corner stools
    const stoolMat = own(new T.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    [[-3.45, -3.45, 0xc1121f], [3.45, 3.45, 0x1e5fd6]].forEach((s) => {
      const st = new T.Mesh(own(new T.CylinderGeometry(0.2, 0.17, 0.5, 14)), stoolMat);
      st.position.set(s[0], 0.25, s[1]); st.castShadow = true; G.add(st);
      const top = new T.Mesh(own(new T.CylinderGeometry(0.24, 0.24, 0.06, 14)), own(new T.MeshStandardMaterial({ color: s[2], roughness: 0.6 })));
      top.position.set(s[0], 0.53, s[1]); G.add(top);
    });

    /* ---------------- stands ---------------- */
    const tierMat = own(new T.MeshStandardMaterial({ color: 0x15171f, roughness: 0.9 }));
    const nTiers = quality === 'low' ? 3 : quality === 'med' ? 4 : 5;
    const tiers = [];
    for (let i = 0; i < nTiers; i++) {
      const R = 7.4 + i * 1.2;
      const top = -0.55 + i * 0.62;
      const hgt = top + 1.0;
      const sizeA = 2 * R + 2.4;
      const mk = (w, d, x, z) => {
        const b = new T.Mesh(own(new T.BoxGeometry(w, hgt, d)), tierMat);
        b.position.set(x, top - hgt / 2, z); b.receiveShadow = true; G.add(b);
      };
      mk(sizeA, 1.2, 0, -R); mk(sizeA, 1.2, 0, R);
      mk(1.2, sizeA, -R, 0); mk(1.2, sizeA, R, 0);
      tiers.push({ R, top });
    }
    // LED ad boards
    const ads = ['PUNCH-COLA', 'IRON GLOVES', 'ROUND ONE ENERGY', 'KO FITNESS', 'GLOVE & CO', 'HEAVY HITTERS'];
    const adBoard = (i, x, z, ry) => {
      const t = own(canvasTex(512, 64, (g, w, h) => drawBanner(g, w, h, ads[i % ads.length], ['#0b6bcb', '#c1121f', '#0d8a4f', '#8a2be2', '#d9822b', '#222'][i % 6], '#fff')));
      const m = new T.Mesh(own(new T.PlaneGeometry(5.6, 0.7)), own(new T.MeshBasicMaterial({ map: t })));
      m.position.set(x, -0.15, z); m.rotation.y = ry; G.add(m);
    };
    const bd = 6.65;
    for (let i = 0; i < 3; i++) {
      adBoard(i, -4.0 + i * 4.0, -bd, 0);
      adBoard(i + 3, -4.0 + i * 4.0, bd, Math.PI);
      adBoard(i + 1, -bd, -4.0 + i * 4.0, Math.PI / 2);
      adBoard(i + 4, bd, -4.0 + i * 4.0, -Math.PI / 2);
    }

    /* ---------------- crowd (instanced, GPU bobbing) ---------------- */
    arena.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
    const spacing = quality === 'low' ? 0.95 : quality === 'med' ? 0.7 : 0.56;
    const people = [];
    tiers.forEach((tr) => {
      const R = tr.R, y = tr.top;
      const n = Math.floor((2 * R) / spacing);
      for (let k = 0; k <= n; k++) {
        const u = -R + k * spacing;
        people.push([u, y, -R + 0.05, 0]);
        people.push([u, y, R - 0.05, Math.PI]);
        if (Math.abs(u) < R - 0.7) {
          people.push([-R + 0.05, y, u, Math.PI / 2]);
          people.push([R - 0.05, y, u, -Math.PI / 2]);
        }
      }
    });
    const count = people.length;
    arena.crowdCount = count;
    const bodyGeo = own(new T.CapsuleGeometry(0.21, 0.26, 3, 8));
    const headGeo = own(new T.SphereGeometry(0.14, 10, 8));
    const bodyMat = own(new T.MeshLambertMaterial({ color: 0xffffff }));
    const headMat = own(new T.MeshLambertMaterial({ color: 0xffffff }));
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = Math.random();
    const attach = (geo, mat) => {
      const g2 = geo.clone();
      g2.setAttribute('aPhase', new T.InstancedBufferAttribute(phases, 1));
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = arena.crowdUniforms.uTime;
        shader.uniforms.uExcite = arena.crowdUniforms.uExcite;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n float bb = sin(uTime*(2.5+aPhase*3.0)+aPhase*40.0); transformed.y += (max(bb,0.0)*0.2*uExcite + 0.015*bb) * (0.6+aPhase*0.8);');
      };
      return g2;
    };
    const bodyMesh = new T.InstancedMesh(attach(bodyGeo, bodyMat), bodyMat, count);
    const headMesh = new T.InstancedMesh(attach(headGeo, headMat), headMat, count);
    bodyMesh.frustumCulled = false; headMesh.frustumCulled = false;
    const shirts = ['#c1121f', '#1e5fd6', '#16a34a', '#f2b705', '#e5e5e5', '#2a2a30', '#7c3aed', '#ff7a00', '#0ea5a4', '#ec4899', '#8b5e3c'];
    const dummy = new T.Object3D();
    const col = new T.Color();
    people.forEach((p, i) => {
      const s = BX.rand(0.9, 1.1);
      dummy.position.set(p[0], p[1] + 0.34 * s, p[2]);
      dummy.rotation.set(0, p[3], 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      bodyMesh.setColorAt(i, col.set(BX.pick(shirts)).multiplyScalar(BX.rand(0.35, 0.8)));
      dummy.position.y = p[1] + 0.34 * s + 0.4 * s;
      dummy.updateMatrix();
      headMesh.setMatrixAt(i, dummy.matrix);
      headMesh.setColorAt(i, col.set(BX.pick(BX.SKINS)).multiplyScalar(BX.rand(0.45, 0.8)));
    });
    bodyMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true;
    bodyMesh.instanceColor.needsUpdate = true; headMesh.instanceColor.needsUpdate = true;
    G.add(bodyMesh); G.add(headMesh);
    arena.crowdMeshes = [bodyMesh, headMesh];

    /* ---------------- camera flashes ---------------- */
    const gTex = own(glowTex());
    arena.flashes = [];
    const nFlash = quality === 'low' ? 0 : 10;
    for (let i = 0; i < nFlash; i++) {
      const s = new T.Sprite(own(new T.SpriteMaterial({ map: gTex, color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })));
      const tr = BX.pick(tiers);
      const side = BX.randi(0, 3);
      const u = BX.rand(-tr.R + 1, tr.R - 1);
      const pos = side === 0 ? [u, tr.R] : side === 1 ? [u, -tr.R] : side === 2 ? [tr.R, u] : [-tr.R, u];
      s.position.set(pos[0] * 0.98, tr.top + 1.2, pos[1] * 0.98);
      s.scale.setScalar(0.9);
      s.userData = { life: 0, next: BX.rand(0.2, 4) };
      G.add(s); arena.flashes.push(s);
    }

    /* ---------------- lighting rig + visible beams ---------------- */
    const rigMat = own(new T.MeshStandardMaterial({ color: 0x23262f, roughness: 0.6, metalness: 0.3 }));
    const beamMat = own(new T.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.045, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    const lampMat = own(new T.MeshBasicMaterial({ color: 0xfff6e0 }));
    const rigHeight = 8.6;
    const nLamps = 6;
    arena.beams = [];
    for (let i = 0; i < nLamps; i++) {
      const a = (i / nLamps) * Math.PI * 2 + 0.3;
      const x = Math.sin(a) * 4.4, z = Math.cos(a) * 4.4;
      const lamp = new T.Mesh(own(new T.CylinderGeometry(0.28, 0.2, 0.4, 14)), rigMat);
      lamp.position.set(x, rigHeight, z); G.add(lamp);
      const bulb = new T.Mesh(own(new T.CircleGeometry(0.2, 14)), lampMat);
      bulb.rotation.x = Math.PI / 2; bulb.position.set(x, rigHeight - 0.21, z); G.add(bulb);
      const len = rigHeight + 0.5;
      const beam = new T.Mesh(own(new T.CylinderGeometry(0.2, 1.9, len, 22, 1, true)), beamMat);
      const target = new T.Vector3(x * 0.3, 0, z * 0.3);
      const from = new T.Vector3(x, rigHeight - 0.2, z);
      beam.position.copy(from).add(target).multiplyScalar(0.5);
      const dir = new T.Vector3().subVectors(target, from).normalize();
      beam.quaternion.setFromUnitVectors(new T.Vector3(0, -1, 0), dir);
      beam.scale.y = from.distanceTo(target) / len;
      G.add(beam); arena.beams.push(beam);
    }
    // ring truss
    const truss = new T.Mesh(own(new T.TorusGeometry(4.4, 0.08, 6, 36)), rigMat);
    truss.rotation.x = Math.PI / 2; truss.position.y = rigHeight + 0.25; G.add(truss);

    /* ---------------- jumbotron ---------------- */
    const screenTex = own(canvasTex(512, 288, (g, w, h) => { g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h); }));
    arena.screenTex = screenTex;
    const jumbo = new T.Group();
    jumbo.position.set(0, 6.0, 0);
    const jBody = new T.Mesh(own(new T.BoxGeometry(2.2, 1.35, 2.2)), rigMat);
    jumbo.add(jBody);
    const scrMat = own(new T.MeshBasicMaterial({ map: screenTex }));
    const scrGeo = own(new T.PlaneGeometry(2.0, 1.125));
    [[0, 1.11, 0], [Math.PI / 2, 0, 1.11], [Math.PI, 0, -1.11], [-Math.PI / 2, 0, -1.11]].forEach((d, i) => {
      const m = new T.Mesh(scrGeo, scrMat);
      const ry = [0, Math.PI / 2, Math.PI, -Math.PI / 2][i];
      m.rotation.y = ry;
      m.position.set(Math.sin(ry) * 1.11, 0, Math.cos(ry) * 1.11);
      jumbo.add(m);
    });
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) {
      const cable = new T.Mesh(own(new T.CylinderGeometry(0.015, 0.015, 3, 6)), rigMat);
      cable.position.set(sx, 2.1, sz); jumbo.add(cable);
    }
    G.add(jumbo);
    arena.jumbo = jumbo;
    arena._screenKey = '';

    /* ---------------- API ---------------- */
    arena.drawScreen = (info) => {
      const k = JSON.stringify(info);
      if (k === arena._screenKey) return;
      arena._screenKey = k;
      const g = screenTex.userData.ctx, w = 512, h = 288;
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#0b1020'); grd.addColorStop(1, '#05070d');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#e8b923'; g.font = '700 34px ' + FONT;
      g.fillText(info.title || 'KNOCKOUT ARENA', w / 2, 34);
      if (info.timer != null) {
        g.fillStyle = '#ffffff'; g.font = '700 108px ' + FONT;
        g.fillText(info.timer, w / 2, 130);
      }
      if (info.sub) { g.fillStyle = '#9fb0d6'; g.font = '700 30px ' + FONT; g.fillText(info.sub, w / 2, 196); }
      const bar = (x, name, frac, color, align) => {
        g.textAlign = align; g.fillStyle = color; g.font = '700 30px ' + FONT;
        g.fillText(name, x, 238);
        const bw = 190, bx = align === 'left' ? x : x - bw;
        g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(bx, 256, bw, 12);
        g.fillStyle = color; g.fillRect(align === 'left' ? bx : bx + bw * (1 - frac), 256, bw * frac, 12);
      };
      if (info.p1) bar(26, info.p1.name, info.p1.frac, info.p1.color, 'left');
      if (info.p2) bar(w - 26, info.p2.name, info.p2.frac, info.p2.color, 'right');
      screenTex.needsUpdate = true;
    };

    arena.setExcitement = (v) => { arena.excite = v; };
    // hide the ring ropes between the camera and the fighters when the camera is outside the ring
    arena.cullRopes = (cam) => {
      const lim = P + 0.25;
      for (const r of arena.ropes) {
        const s = r.userData.side;
        r.visible = !((s === 0 && cam.z < -lim) || (s === 1 && cam.z > lim) || (s === 2 && cam.x < -lim) || (s === 3 && cam.x > lim));
      }
    };
    arena.excite = 0.2;
    arena.kickRope = (side, amt) => {
      for (const r of arena.ropes) if (r.userData.side === side) r.userData.kick = Math.max(r.userData.kick, amt);
    };
    arena.strobe = 0;
    arena.update = (dt, focus, t) => {
      arena.crowdUniforms.uTime.value = t;
      arena.crowdUniforms.uExcite.value = BX.damp(arena.crowdUniforms.uExcite.value, arena.excite, 2.5, dt);
      // key light follows the action a little
      if (focus) {
        key.target.position.x = BX.damp(key.target.position.x, focus.x * 0.6, 3, dt);
        key.target.position.z = BX.damp(key.target.position.z, focus.z * 0.6, 3, dt);
      }
      // rope wobble
      for (const r of arena.ropes) {
        const u = r.userData;
        if (u.kick > 0.001) {
          u.kick *= Math.exp(-4 * dt);
          r.position.y = u.baseY + Math.sin(t * 28) * 0.05 * u.kick;
        } else if (r.position.y !== u.baseY) r.position.y = u.baseY;
      }
      // camera flashes
      for (const s of arena.flashes) {
        const u = s.userData;
        if (u.life > 0) { u.life -= dt; s.material.opacity = Math.max(0, u.life / 0.09); s.scale.setScalar(0.5 + (1 - s.material.opacity) * 0.8); }
        else {
          u.next -= dt * (0.4 + arena.excite * 3);
          if (u.next <= 0) { u.life = 0.09; u.next = BX.rand(0.3, 3.5); s.material.opacity = 1; }
        }
      }
      // strobe on big moments
      if (arena.strobe > 0) {
        arena.strobe = Math.max(0, arena.strobe - dt * 2.5);
        hemi.intensity = 0.55 + arena.strobe * 1.2;
      } else hemi.intensity = 0.55;
    };

    arena.dispose = () => {
      scene.remove(G);
      disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
    };
    return arena;
  }

  BX.Arena = { build };
})();
