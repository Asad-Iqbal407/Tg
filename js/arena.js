/* Knockout Arena — the ring, hall, lights, instanced animated crowd, jumbotron.
 * build(scene, tier): `tier` comes from BX.Perf.resolve() and decides lights, materials, shadow map, crowd size/LOD and beams.
 * After build, the governor flips FREE features through arena.setFeatures() (no shader recompiles). */
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

  /** Speckle overlay: one 256² random ImageData tiled as a pattern (≈ 20x cheaper than thousands of fillRect calls). */
  function speckle(g, w, h, rgb, amount) {
    const n = 256;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const cg = c.getContext('2d');
    const img = cg.createImageData(n, n);
    const d = img.data;
    for (let i = 0; i < n * n; i++) {
      d[i * 4] = rgb; d[i * 4 + 1] = rgb; d[i * 4 + 2] = rgb;
      d[i * 4 + 3] = Math.random() < 0.5 ? Math.random() * 255 * amount : 0;
    }
    cg.putImageData(img, 0, 0);
    g.fillStyle = g.createPattern(c, 'repeat');
    g.fillRect(0, 0, w, h);
  }

  function drawMat(g, w, h) {
    g.fillStyle = '#7a1018'; g.fillRect(0, 0, w, h);                 // apron
    const m = Math.round(w * 0.074);                                   // 0.55m margin of 7.4m
    g.fillStyle = '#183c70'; g.fillRect(m, m, w - 2 * m, h - 2 * m);  // canvas
    speckle(g, w, h, 255, 0.07);                                       // weave / wear
    speckle(g, w, h, 0, 0.1);
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

  function blobTex() {
    return canvasTex(64, 64, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.9)'); r.addColorStop(0.55, 'rgba(0,0,0,0.5)'); r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
  }

  function build(scene, tier) {
    const arena = { group: new T.Group(), tier, quality: tier.id, tierKey: tier.key };
    const G = arena.group;
    scene.add(G);
    const disposables = [];
    const own = (o) => { disposables.push(o); return o; };
    // Lambert for the static set on cheaper tiers (a quarter of the fragment cost, same look under this lighting)
    const M = (p) => {
      if (!tier.lambertStatics) return own(new T.MeshStandardMaterial(p));
      const q = Object.assign({}, p);
      delete q.roughness; delete q.metalness;
      if (q.color != null && typeof q.color === 'number') { const c = new T.Color(q.color); c.multiplyScalar(1.03); q.color = c; }
      return own(new T.MeshLambertMaterial(q));
    };

    scene.background = new T.Color(0x04050a);
    scene.fog = new T.FogExp2(0x04050a, 0.034);

    /* ---------------- lights ---------------- */
    arena.hemiBase = tier.hemi;
    const hemi = new T.HemisphereLight(0x8fa4d0, 0x221a14, arena.hemiBase);
    G.add(hemi);
    const key = new T.SpotLight(0xfff1dc, 1.55, 0, 0.62, 0.55, 1);
    key.position.set(0.6, 9.5, 1.2);
    key.target.position.set(0, 0, 0);
    key.castShadow = tier.shadowMap > 0;
    if (key.castShadow) {
      key.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
      key.shadow.camera.near = 4; key.shadow.camera.far = 16;
      key.shadow.bias = -0.0004;
      key.shadow.focus = tier.shadowFocus;   // the ring only needs the central part of the spot cone
    }
    G.add(key); G.add(key.target);
    const fills = [];
    const addFill = (color, intensity, dist, x, z) => { const l = new T.PointLight(color, intensity, dist, 1.4); l.position.set(x, 3, z); G.add(l); fills.push(l); };
    if (tier.pointLights >= 1) addFill(0xff3b30, tier.pointLights === 1 ? 0.55 * 1.8 : 0.55, 14, -5, -5);
    if (tier.pointLights >= 2) addFill(0x2f7bff, 0.55, 14, 5, 5);
    if (tier.pointLights >= 3) addFill(0xffffff, 0.35, 12, 5, -5);
    arena.lights = { hemi, key, fills };

    /* ---------------- hall floor ---------------- */
    const floorTex = own(canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#0e1016'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 255, 0.05);
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
    }, true));
    floorTex.repeat.set(10, 10);
    const hall = new T.Mesh(own(new T.PlaneGeometry(80, 80)), M({ map: floorTex, roughness: 0.55, metalness: 0.2 }));
    hall.rotation.x = -Math.PI / 2; hall.position.y = -1.0;
    G.add(hall);

    /* ---------------- ring ---------------- */
    const matTex = own(canvasTex(1024, 1024, drawMat));
    const skirtTex = own(canvasTex(1480, 200, (g, w, h) => drawBanner(g, w, h, 'KNOCKOUT ARENA', '#9b111e', '#ffffff')));
    const sideMat = M({ map: skirtTex, roughness: 0.8 });
    const topMat = M({ map: matTex, roughness: 0.95 });
    const botMat = M({ color: 0x111111 });
    const platform = new T.Mesh(own(new T.BoxGeometry(7.4, 1.0, 7.4)), [sideMat, sideMat, topMat, botMat, sideMat, sideMat]);
    platform.position.y = -0.5;
    platform.receiveShadow = tier.shadowMap > 0;     // the only receiver in the scene
    G.add(platform);
    arena.floor = platform;

    const chrome = M({ color: 0xdfe3ea, roughness: 0.4, metalness: 0.25, emissive: 0x20242b });
    const padCols = [0xc1121f, 0x1e5fd6, 0xf2f2f2, 0xf2f2f2];
    const P = 3.02;
    const corners = [[-P, -P], [P, -P], [-P, P], [P, P]];
    const casts = tier.shadowMap > 0;
    arena.posts = [];
    corners.forEach((c, i) => {
      const post = new T.Mesh(own(new T.CylinderGeometry(0.07, 0.07, 1.62, 14)), chrome);
      post.position.set(c[0], 0.81, c[1]); post.castShadow = casts; G.add(post);
      const pad = new T.Mesh(own(new T.BoxGeometry(0.34, 1.0, 0.34)), M({ color: padCols[i], roughness: 0.7 }));
      pad.position.set(c[0] * 0.985, 0.78, c[1] * 0.985); pad.castShadow = casts; G.add(pad);
      const cap = new T.Mesh(own(new T.SphereGeometry(0.085, 12, 8)), chrome);
      cap.position.set(c[0], 1.64, c[1]); G.add(cap);
      arena.posts.push({ x: c[0], z: c[1], meshes: [post, pad, cap] });
    });
    const ropeCols = [0xf2f2f2, 0xc1121f, 0x1e5fd6];
    const ropeY = [0.55, 0.95, 1.35];
    arena.ropes = [];
    const ropeG = own(new T.CylinderGeometry(0.026, 0.026, 2 * P, 8));
    ropeY.forEach((y, ri) => {
      const mat = M({ color: ropeCols[ri], roughness: 0.55 });
      for (let s = 0; s < 4; s++) {
        const rope = new T.Mesh(ropeG, mat);
        const horizontal = s < 2;
        rope.position.set(horizontal ? 0 : (s === 2 ? -P : P), y, horizontal ? (s === 0 ? -P : P) : 0);
        if (horizontal) rope.rotation.set(0, 0, Math.PI / 2); else rope.rotation.set(Math.PI / 2, 0, 0);
        rope.castShadow = tier.id === 'high' && casts;
        rope.userData = { baseY: y, side: s, kick: 0 };
        G.add(rope);
        arena.ropes.push(rope);
      }
    });
    // corner stools
    const stoolMat = M({ color: 0x222222, roughness: 0.8 });
    [[-3.45, -3.45, 0xc1121f], [3.45, 3.45, 0x1e5fd6]].forEach((s) => {
      const st = new T.Mesh(own(new T.CylinderGeometry(0.2, 0.17, 0.5, 14)), stoolMat);
      st.position.set(s[0], 0.25, s[1]); st.castShadow = casts; G.add(st);
      const top = new T.Mesh(own(new T.CylinderGeometry(0.24, 0.24, 0.06, 14)), M({ color: s[2], roughness: 0.6 }));
      top.position.set(s[0], 0.53, s[1]); G.add(top);
    });

    /* ---------------- stands ---------------- */
    const tierMat = M({ color: 0x15171f, roughness: 0.9 });
    const nTiers = tier.crowd.tiers;
    const tiers = [];
    const standBoxes = [];
    for (let i = 0; i < nTiers; i++) {
      const R = 7.4 + i * 1.2;
      const top = -0.55 + i * 0.62;
      const hgt = top + 1.0;
      const sizeA = 2 * R + 2.4;
      const mk = (w, d, x, z) => {
        const b = new T.Mesh(own(new T.BoxGeometry(w, hgt, d)), tierMat);
        b.position.set(x, top - hgt / 2, z); G.add(b); standBoxes.push(b);
      };
      mk(sizeA, 1.2, 0, -R); mk(sizeA, 1.2, 0, R);
      mk(1.2, sizeA, -R, 0); mk(1.2, sizeA, R, 0);
      tiers.push({ R, top });
    }
    arena.merged = [];
    BX.mergeMeshes(G, standBoxes).forEach((g) => { own(g); arena.merged.push(g); });      // 4 boxes per tier -> one draw call
    // LED ad boards (six distinct textures, shared)
    const ads = ['PUNCH-COLA', 'IRON GLOVES', 'ROUND ONE ENERGY', 'KO FITNESS', 'GLOVE & CO', 'HEAVY HITTERS'];
    const adCols = ['#0b6bcb', '#c1121f', '#0d8a4f', '#8a2be2', '#d9822b', '#222'];
    const adMats = ads.map((txt, i) => own(new T.MeshBasicMaterial({ map: own(canvasTex(512, 64, (g, w, h) => drawBanner(g, w, h, txt, adCols[i], '#fff'))) })));
    const adGeo = own(new T.PlaneGeometry(5.6, 0.7));
    const adMeshes = [];
    const adBoard = (i, x, z, ry) => {
      const m = new T.Mesh(adGeo, adMats[i % ads.length]);
      m.position.set(x, -0.15, z); m.rotation.y = ry; G.add(m); adMeshes.push(m);
    };
    const bd = 6.65;
    for (let i = 0; i < 3; i++) {
      adBoard(i, -4.0 + i * 4.0, -bd, 0);
      adBoard(i + 3, -4.0 + i * 4.0, bd, Math.PI);
      adBoard(i + 1, -bd, -4.0 + i * 4.0, Math.PI / 2);
      adBoard(i + 4, bd, -4.0 + i * 4.0, -Math.PI / 2);
    }

    // the ad boards use plain (non-indexed-safe) planes: merge per material, keeping UVs
    adMeshes.forEach((m) => { m.updateMatrix(); });
    {
      const byMat = new Map();
      adMeshes.forEach((m) => { const l = byMat.get(m.material) || []; l.push(m); byMat.set(m.material, l); });
      byMat.forEach((list, mat) => {
        const parts = list.map((m) => { const g = m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
        let vc = 0, ic = 0; parts.forEach((g) => { vc += g.attributes.position.count; ic += g.index.count; });
        const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint16Array(ic);
        let vo = 0, io = 0;
        parts.forEach((g) => { const c = g.attributes.position.count; pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); uv.set(g.attributes.uv.array, vo * 2); for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo; vo += c; g.dispose(); });
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3)); geo.setAttribute('normal', new T.BufferAttribute(nor, 3)); geo.setAttribute('uv', new T.BufferAttribute(uv, 2)); geo.setIndex(new T.BufferAttribute(idx, 1));
        geo.computeBoundingSphere(); own(geo);
        list.forEach((m) => G.remove(m));
        G.add(new T.Mesh(geo, mat));
      });
    }

    /* ---------------- crowd: shuffled, split into angular chunks (frustum culled), low-poly LOD, GPU bobbing ---------------- */
    arena.crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
    const people = [];
    tiers.forEach((tr) => {
      const R = tr.R, y = tr.top, spacing = tier.crowd.spacing;
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
    // Fisher-Yates: a count-prefix of any chunk is then a uniform thinning of the crowd (governor: crowd x0.5)
    for (let i = people.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = people[i]; people[i] = people[j]; people[j] = t; }
    arena.crowdCount = people.length;
    const bodyMat = own(new T.MeshLambertMaterial({ color: 0xffffff }));
    const headMat = own(new T.MeshLambertMaterial({ color: 0xffffff }));
    for (const mat of [bodyMat, headMat]) {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = arena.crowdUniforms.uTime;
        shader.uniforms.uExcite = arena.crowdUniforms.uExcite;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uTime;\nuniform float uExcite;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n float bb = sin(uTime*(2.5+aPhase*3.0)+aPhase*40.0); transformed.y += (max(bb,0.0)*0.2*uExcite + 0.015*bb) * (0.6+aPhase*0.8);');
      };
    }
    const lodA = tier.crowd.lod === 'A';
    const bodyGeoSrc = lodA ? new T.CapsuleGeometry(0.21, 0.26, 2, 8) : new T.CapsuleGeometry(0.21, 0.26, 1, 6);
    const headGeoSrc = lodA ? new T.SphereGeometry(0.14, 7, 5) : new T.SphereGeometry(0.14, 6, 4);
    own(bodyGeoSrc); own(headGeoSrc);
    const shirts = ['#c1121f', '#1e5fd6', '#16a34a', '#f2b705', '#e5e5e5', '#2a2a30', '#7c3aed', '#ff7a00', '#0ea5a4', '#ec4899', '#8b5e3c'];
    const nChunks = tier.crowd.chunks;
    const sectors = Array.from({ length: nChunks }, () => []);
    people.forEach((p) => {
      const ang = Math.atan2(p[2], p[0]);
      sectors[Math.min(nChunks - 1, Math.floor(((ang + Math.PI) / (Math.PI * 2)) * nChunks))].push(p);
    });
    const dummy = new T.Object3D();
    const col = new T.Color();
    arena.crowdMeshes = [];
    sectors.forEach((list) => {
      if (!list.length) return;
      const n = list.length;
      const bb = new T.Box3();
      const meshes = [[bodyGeoSrc, bodyMat, 0], [headGeoSrc, headMat, 1]].map(([src, mat, kind]) => {
        const g = own(src.clone());
        const ph = new Float32Array(n);
        for (let i = 0; i < n; i++) ph[i] = Math.random();
        g.setAttribute('aPhase', new T.InstancedBufferAttribute(ph, 1));
        const m = own(new T.InstancedMesh(g, mat, n));
        m.userData.max = n;
        return m;
      });
      list.forEach((p, i) => {
        const s = BX.rand(0.9, 1.1);
        dummy.position.set(p[0], p[1] + 0.34 * s, p[2]);
        dummy.rotation.set(0, p[3], 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        meshes[0].setMatrixAt(i, dummy.matrix);
        meshes[0].setColorAt(i, col.set(BX.pick(shirts)).multiplyScalar(BX.rand(0.35, 0.8)));
        bb.expandByPoint(dummy.position);
        dummy.position.y = p[1] + 0.34 * s + 0.4 * s;
        dummy.updateMatrix();
        meshes[1].setMatrixAt(i, dummy.matrix);
        meshes[1].setColorAt(i, col.set(BX.pick(BX.SKINS)).multiplyScalar(BX.rand(0.45, 0.8)));
      });
      const center = bb.getCenter(new T.Vector3());
      const radius = bb.getSize(new T.Vector3()).length() / 2 + 1.2;   // + body size + bobbing
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
        m.geometry.boundingSphere = new T.Sphere(center, radius);       // InstancedMesh culls with the geometry sphere
        m.frustumCulled = true;
        G.add(m);
        arena.crowdMeshes.push(m);
      }
    });

    /* ---------------- camera flashes ---------------- */
    const gTex = own(glowTex());
    arena.flashes = [];
    for (let i = 0; i < tier.flashes; i++) {
      const s = new T.Sprite(own(new T.SpriteMaterial({ map: gTex, color: 0xffffff, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false })));
      const tr = BX.pick(tiers);
      const side = BX.randi(0, 3);
      const u = BX.rand(-tr.R + 1, tr.R - 1);
      const pos = side === 0 ? [u, tr.R] : side === 1 ? [u, -tr.R] : side === 2 ? [tr.R, u] : [-tr.R, u];
      s.position.set(pos[0] * 0.98, tr.top + 1.2, pos[1] * 0.98);
      s.scale.setScalar(0.9);
      s.visible = false;
      s.userData = { life: 0, next: BX.rand(0.2, 4) };
      G.add(s); arena.flashes.push(s);
    }

    /* ---------------- lighting rig + visible beams ---------------- */
    const rigMat = M({ color: 0x23262f, roughness: 0.6, metalness: 0.3 });
    // cheaper tiers: front faces only + stronger opacity = similar brightness for half the blended fill
    const beamMat = own(new T.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.045 * tier.beamK / tier.beams, blending: T.AdditiveBlending, depthWrite: false, side: tier.beamDouble ? T.DoubleSide : T.FrontSide }));
    const lampMat = own(new T.MeshBasicMaterial({ color: 0xfff6e0 }));
    const rigHeight = 8.6;
    const nLamps = 6;
    arena.beams = [];
    const rigMeshes = [], bulbMeshes = [];
    for (let i = 0; i < nLamps; i++) {
      const a = (i / nLamps) * Math.PI * 2 + 0.3;
      const x = Math.sin(a) * 4.4, z = Math.cos(a) * 4.4;
      const lamp = new T.Mesh(own(new T.CylinderGeometry(0.28, 0.2, 0.4, 14)), rigMat);
      lamp.position.set(x, rigHeight, z); G.add(lamp); rigMeshes.push(lamp);
      const bulb = new T.Mesh(own(new T.CircleGeometry(0.2, 14)), lampMat);
      bulb.rotation.x = Math.PI / 2; bulb.position.set(x, rigHeight - 0.21, z); G.add(bulb); bulbMeshes.push(bulb);
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
    const truss = new T.Mesh(own(new T.TorusGeometry(4.4, 0.08, 6, 36)), rigMat);
    truss.rotation.x = Math.PI / 2; truss.position.y = rigHeight + 0.25; G.add(truss); rigMeshes.push(truss);
    BX.mergeMeshes(G, rigMeshes).forEach((g) => { own(g); arena.merged.push(g); });
    BX.mergeMeshes(G, bulbMeshes).forEach((g) => { own(g); arena.merged.push(g); });

    /* ---------------- jumbotron ---------------- */
    const screenTex = own(canvasTex(512, 288, (g, w, h) => { g.fillStyle = '#05070d'; g.fillRect(0, 0, w, h); }));
    arena.screenTex = screenTex;
    const jumbo = new T.Group();
    jumbo.position.set(0, 6.0, 0);
    const jBody = new T.Mesh(own(new T.BoxGeometry(2.2, 1.35, 2.2)), rigMat);
    jumbo.add(jBody);
    const scrMat = own(new T.MeshBasicMaterial({ map: screenTex }));
    const scrGeo = own(new T.PlaneGeometry(2.0, 1.125));
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((ry) => {
      const m = new T.Mesh(scrGeo, scrMat);
      m.rotation.y = ry;
      m.position.set(Math.sin(ry) * 1.11, 0, Math.cos(ry) * 1.11);
      jumbo.add(m);
    });
    const cableGeo = own(new T.CylinderGeometry(0.015, 0.015, 3, 6));
    const jumboStatic = [jBody];
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) {
      const cable = new T.Mesh(cableGeo, rigMat);
      cable.position.set(sx, 2.1, sz); jumbo.add(cable); jumboStatic.push(cable);
    }
    BX.mergeMeshes(jumbo, jumboStatic).forEach((g) => { own(g); arena.merged.push(g); });
    G.add(jumbo);
    arena.jumbo = jumbo;
    arena._screenKey = '';

    /* ---------------- blob shadows (used when the shadow map is off) ---------------- */
    const blobMat = own(new T.MeshBasicMaterial({ map: own(blobTex()), transparent: true, opacity: 0.6, depthWrite: false }));
    const blobGeo = own(new T.PlaneGeometry(1, 1));
    arena.blobs = [];
    for (let i = 0; i < 3; i++) {
      const b = new T.Mesh(blobGeo, blobMat);
      b.rotation.x = -Math.PI / 2; b.position.y = 0.014; b.renderOrder = 1; b.visible = false;
      G.add(b); arena.blobs.push(b);
    }
    arena.blobTargets = [];
    arena.blobsOn = tier.shadowMap === 0;

    /* ---------------- API ---------------- */
    arena.drawScreen = (info) => {
      const k = (info.title || '') + '|' + info.timer + '|' + (info.sub || '') + '|' + (info.p1 ? info.p1.name + ':' + Math.round(info.p1.frac * 40) : '') + '|' + (info.p2 ? info.p2.name + ':' + Math.round(info.p2.frac * 40) : '');
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
      // never let a corner post fill the screen
      for (const p of arena.posts) {
        const show = Math.hypot(cam.x - p.x, cam.z - p.z) > 1.5;
        for (const m of p.meshes) m.visible = show;
      }
    };
    arena.excite = 0.2;
    arena.kickRope = (side, amt) => {
      for (const r of arena.ropes) if (r.userData.side === side) r.userData.kick = Math.max(r.userData.kick, amt);
    };
    arena.setBlobTargets = (list) => { arena.blobTargets = list.filter(Boolean); };

    /** Free runtime switches used by the governor (no shader recompiles): beams, flashes, shadow receiving, crowd density. */
    arena.features = { beams: tier.beams, flashes: tier.flashes > 0, shadows: tier.shadowMap > 0, crowd: 1 };
    arena.setFeatures = (f) => {
      const F = arena.features;
      if (f.beams != null) F.beams = Math.min(f.beams, tier.beams); else F.beams = tier.beams;
      if (f.flashes != null) F.flashes = !!f.flashes && tier.flashes > 0;
      if (f.shadows != null) F.shadows = !!f.shadows && tier.shadowMap > 0;
      if (f.crowd != null) F.crowd = f.crowd;
      const n = Math.max(1, F.beams), step = Math.max(1, Math.round(arena.beams.length / n));
      arena.beams.forEach((b, i) => { b.visible = i % step === 0; });
      beamMat.opacity = 0.045 * tier.beamK / Math.max(1, arena.beams.filter((b) => b.visible).length);   // constant total brightness
      if (!F.flashes) for (const s of arena.flashes) { s.visible = false; s.userData.life = 0; }
      arena.floor.receiveShadow = F.shadows;
      arena.blobsOn = !F.shadows;
      for (const m of arena.crowdMeshes) m.count = Math.max(1, Math.ceil(m.userData.max * F.crowd));
    };
    arena.setFeatures({});

    arena.strobe = 0;
    const _bp = new T.Vector3();
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
      // camera flashes (hidden sprites are not drawn)
      if (arena.features.flashes) {
        for (const s of arena.flashes) {
          const u = s.userData;
          if (u.life > 0) {
            u.life -= dt;
            if (u.life <= 0) { s.visible = false; continue; }
            s.material.opacity = Math.max(0, u.life / 0.09); s.scale.setScalar(0.5 + (1 - s.material.opacity) * 0.8);
          } else {
            u.next -= dt * (0.4 + arena.excite * 3);
            if (u.next <= 0) { u.life = 0.09; u.next = BX.rand(0.3, 3.5); s.material.opacity = 1; s.visible = true; }
          }
        }
      }
      // blob shadows under the boxers and the referee
      for (let i = 0; i < arena.blobs.length; i++) {
        const b = arena.blobs[i], f = arena.blobTargets[i];
        if (!arena.blobsOn || !f || !f.root.visible) { b.visible = false; continue; }
        b.visible = true;
        const fall = f.fall || 0;
        b.position.set(f.root.position.x - Math.sin(f.root.rotation.y) * 0.8 * fall, 0.014, f.root.position.z - Math.cos(f.root.rotation.y) * 0.8 * fall);
        const s = 1.15 * (1 + fall * 1.0);
        b.scale.set(s, s, 1);
      }
      // strobe on big moments
      if (arena.strobe > 0) {
        arena.strobe = Math.max(0, arena.strobe - dt * 2.5);
        hemi.intensity = arena.hemiBase + arena.strobe * 1.2;
      } else hemi.intensity = arena.hemiBase;
    };

    arena.dispose = () => {
      scene.remove(G);
      if (key.shadow && key.shadow.map) key.shadow.map.dispose();
      if (key.dispose) key.dispose();
      disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
    };
    return arena;
  }

  BX.Arena = { build };
})();
