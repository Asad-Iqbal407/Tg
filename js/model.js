/* Knockout Arena — procedural 3D boxer avatar (built from primitives, no external assets) */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});
  const T = THREE;

  /** Body-type multipliers. */
  const BUILD = {
    slim:  { w: 0.90, t: 0.90, limb: 0.88, h: 1.04, health: 0.95 },
    avg:   { w: 1.00, t: 1.00, limb: 1.00, h: 1.00, health: 1.00 },
    heavy: { w: 1.17, t: 1.22, limb: 1.22, h: 0.98, health: 1.12 },
  };

  /** Skeleton dimensions (metres, before build scaling). Body space: +x = fighter's left, +y up, +z forward. */
  const D = {
    hipY: 0.88, hipHalf: 0.10, thigh: 0.43, shin: 0.43, ankle: 0.085,
    chestY: 0.14, shX: 0.215, shY: 0.30, neckY: 0.40, headY: 0.17,
    ua: 0.29, fa: 0.27,
  };

  /* ---------- shared geometry cache ---------- */
  const GC = {};
  const sphereG = () => GC.sphere || (GC.sphere = new T.SphereGeometry(1, 22, 16));
  const boxG = () => GC.box || (GC.box = new T.BoxGeometry(1, 1, 1));
  const cylG = (open) => {
    const k = open ? 'cylo' : 'cyl';
    return GC[k] || (GC[k] = new T.CylinderGeometry(1, 1, 1, 22, 1, !!open));
  };
  const coneG = () => GC.cone || (GC.cone = new T.ConeGeometry(1, 1, 10));
  const trunkG = () => GC.trunk || (GC.trunk = new T.CylinderGeometry(1, 1.16, 1, 24, 1, true));
  const capG = (r, len) => {
    const k = 'cap' + r.toFixed(3) + ':' + len.toFixed(3);
    return GC[k] || (GC[k] = new T.CapsuleGeometry(r, len, 6, 14));
  };
  const hairCapG = () => GC.hairCap || (GC.hairCap = new T.SphereGeometry(1, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56));

  function std(color, rough, metal, extra) {
    const m = new T.MeshStandardMaterial(Object.assign({ color: new T.Color(color), roughness: rough == null ? 0.7 : rough, metalness: metal || 0 }, extra || {}));
    return m;
  }

  function mk(geo, mat, parent, x, y, z, sx, sy, sz, cast) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx != null) m.scale.set(sx, sy == null ? sx : sy, sz == null ? sx : sz);
    m.castShadow = cast !== false;
    if (parent) parent.add(m);
    return m;
  }

  function addHair(style, head, mat, skin) {
    const cap = (s, tilt) => {
      const m = mk(hairCapG(), mat, head, 0, 0.16, -0.003, 0.158 * s, 0.172 * s, 0.158 * s);
      m.rotation.x = tilt == null ? -0.34 : tilt;
      return m;
    };
    switch (style) {
      case 'bald': break;
      case 'buzz': cap(1.015); break;
      case 'short': {
        cap(1.06);
        mk(sphereG(), mat, head, 0, 0.305, 0.06, 0.1, 0.045, 0.1);
        break;
      }
      case 'spiky': {
        cap(1.04);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const r = i === 0 ? 0 : 0.085;
          const c = mk(coneG(), mat, head, Math.sin(a) * r, 0.315 - r * 0.25, Math.cos(a) * r * 0.9 - 0.01, 0.034, 0.12, 0.034);
          c.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
        }
        break;
      }
      case 'afro': {
        mk(sphereG(), mat, head, 0, 0.285, -0.05, 0.195, 0.19, 0.19);
        break;
      }
      case 'mohawk': {
        for (let i = 0; i < 8; i++) {
          const t = i / 7;
          const ang = BX.lerp(0.5, -1.7, t);
          const y = 0.17 + Math.sin(ang + 1.2) * 0.15 + 0.1;
          const z = Math.cos(ang + 1.2) * 0.15;
          const b = mk(boxG(), mat, head, 0, y + 0.03, z, 0.034, 0.12, 0.07);
          b.rotation.x = -(ang + 1.2) * 0.6;
        }
        break;
      }
      case 'long': {
        cap(1.06, -0.4);
        mk(capG(0.1, 0.22), mat, head, 0, 0.06, -0.1, 1.15, 1, 0.75);
        break;
      }
      case 'ponytail': {
        cap(1.05);
        const t = mk(capG(0.04, 0.2), mat, head, 0, 0.13, -0.2);
        t.rotation.x = 0.7;
        mk(sphereG(), mat, head, 0, 0.21, -0.145, 0.05, 0.05, 0.05);
        break;
      }
      case 'bun': {
        cap(1.05);
        mk(sphereG(), mat, head, 0, 0.345, -0.07, 0.065, 0.065, 0.065);
        break;
      }
      default: break;
    }
  }

  /** Build a complete boxer (or referee) and return the rig of parts. */
  function buildModel(look, role) {
    const ref = role === 'ref';
    const B = BUILD[look.build] || BUILD.avg;
    const w = B.w, t = B.t, limb = B.limb;
    const mats = {
      skin: std(look.skin, 0.55, 0, { emissive: new T.Color(look.skin).multiplyScalar(0.07) }),
      hair: std(look.hairColor || '#15110e', 0.85),
      trunks: std(look.trunks, 0.75, 0, { side: T.DoubleSide }),
      trim: std(look.trim, 0.6, 0, { side: T.DoubleSide }),
      glove: std(look.gloves, 0.32, 0.05, { emissive: new T.Color(0x000000) }),
      cuff: std('#f1f1f1', 0.6),
      boot: std(look.boots, 0.5, 0.05),
      sole: std('#2b2b2b', 0.7),
      white: std('#ffffff', 0.4),
      dark: std('#1a1a1a', 0.5),
      lip: std(BX.shade(look.skin, -0.35), 0.6),
      shirt: std('#f4f4f4', 0.8),
      pants: std('#151515', 0.8),
      bruise: new T.MeshStandardMaterial({ color: 0x6a2a6e, roughness: 0.9, transparent: true, opacity: 0, depthWrite: false }),
      flush: new T.MeshStandardMaterial({ color: 0xd22a2a, roughness: 0.8, transparent: true, opacity: 0, depthWrite: false }),
    };

    const root = new T.Group();
    const body = new T.Group();
    root.add(body);

    /* ---------------- pelvis & trunks ---------------- */
    const pelvis = new T.Group();
    body.add(pelvis);
    mk(sphereG(), ref ? mats.pants : mats.skin, pelvis, 0, -0.03, 0, 0.185 * w, 0.13, 0.125 * t);
    if (!ref) {
      mk(trunkG(), mats.trunks, pelvis, 0, -0.08, 0, 0.19 * w, 0.30, 0.145 * t);
      mk(cylG(false), mats.trim, pelvis, 0, 0.085, 0, 0.2 * w, 0.07, 0.152 * t);
    } else {
      mk(cylG(true), mats.pants, pelvis, 0, -0.04, 0, 0.2 * w, 0.28, 0.155 * t);
      mk(cylG(true), mats.dark, pelvis, 0, 0.085, 0, 0.206 * w, 0.04, 0.156 * t);
    }

    /* ---------------- chest ---------------- */
    const chest = new T.Group();
    chest.position.set(0, D.chestY, 0);
    pelvis.add(chest);
    const torsoMat = ref ? mats.shirt : mats.skin;
    mk(sphereG(), torsoMat, chest, 0, -0.02, 0, 0.165 * w, 0.20, 0.115 * t);        // abdomen
    mk(sphereG(), torsoMat, chest, 0, 0.17, 0, 0.215 * w, 0.22, 0.135 * t);          // ribcage
    if (!ref) {
      for (const sx of [-1, 1]) {
        mk(sphereG(), mats.skin, chest, sx * 0.095 * w, 0.2, 0.085 * t, 0.095, 0.075, 0.06);   // pecs
        mk(sphereG(), mats.skin, chest, sx * D.shX * w, D.shY - 0.02, 0, 0.085, 0.085, 0.085); // delts
      }
      // abs hint
      for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) mk(sphereG(), mats.skin, chest, sx * 0.04 * w, 0.0 - i * 0.055 + 0.04, 0.1 * t, 0.04, 0.025, 0.02);
    } else {
      for (const sx of [-1, 1]) mk(sphereG(), mats.shirt, chest, sx * D.shX * w, D.shY - 0.02, 0, 0.09, 0.09, 0.09);
      mk(boxG(), mats.dark, chest, 0, 0.15, 0.135 * t, 0.012, 0.3, 0.01); // shirt stripe
    }
    mk(cylG(), mats.skin, chest, 0, 0.375, 0.005, 0.058, 0.12, 0.058);                // neck
    if (ref) {
      mk(coneG(), mats.dark, chest, -0.03, 0.34, 0.1, 0.035, 0.05, 0.02).rotation.z = Math.PI / 2;
      mk(coneG(), mats.dark, chest, 0.03, 0.34, 0.1, 0.035, 0.05, 0.02).rotation.z = -Math.PI / 2;
    }

    /* ---------------- head ---------------- */
    const head = new T.Group();
    head.position.set(0, D.neckY + 0.02, 0.01);
    chest.add(head);
    const skull = mk(sphereG(), mats.skin, head, 0, 0.16, 0, 0.148, 0.165, 0.152);
    mk(sphereG(), mats.skin, head, 0, 0.085, 0.032, 0.115, 0.09, 0.115);              // jaw
    mk(sphereG(), mats.skin, head, 0, 0.1, 0.128, 0.032, 0.03, 0.03);                 // nose (tip)
    mk(sphereG(), mats.skin, head, 0, 0.135, 0.13, 0.02, 0.04, 0.02);                 // nose bridge
    for (const sx of [-1, 1]) {
      mk(sphereG(), mats.skin, head, sx * 0.145, 0.15, -0.005, 0.02, 0.04, 0.03);     // ears
    }
    const eyes = [], pupils = [], brows = [];
    for (const sx of [-1, 1]) {
      const e = mk(sphereG(), mats.white, head, sx * 0.058, 0.185, 0.122, 0.027, 0.02, 0.014, false);
      const p = mk(sphereG(), mats.dark, head, sx * 0.058, 0.185, 0.134, 0.012, 0.012, 0.006, false);
      const b = mk(boxG(), mats.hair, head, sx * 0.058, 0.222, 0.128, 0.058, 0.012, 0.016, false);
      b.rotation.z = -sx * 0.12;
      eyes.push(e); pupils.push(p); brows.push(b);
    }
    // mouth: lips + (mouthguard) teeth that show when the face is hit / the fighter is exerting
    const mouth = new T.Group();
    mouth.position.set(0, 0.065, 0.135);
    head.add(mouth);
    const lips = mk(sphereG(), mats.lip, mouth, 0, 0, 0, 0.034, 0.008, 0.012, false);
    const guard = mk(sphereG(), mats.white, mouth, 0, 0, 0.004, 0.028, 0.0, 0.008, false);
    // bruises / swelling
    const bruises = [];
    for (const sx of [-1, 1]) {
      const b = mk(sphereG(), mats.bruise, head, sx * 0.075, 0.172, 0.108, 0.05, 0.04, 0.035, false);
      bruises.push(b);
      const c = mk(sphereG(), mats.bruise, head, sx * 0.1, 0.1, 0.1, 0.04, 0.035, 0.03, false);
      bruises.push(c);
    }
    const nose = mk(sphereG(), mats.flush, head, 0, 0.1, 0.135, 0.036, 0.034, 0.034, false);
    bruises.push(nose);
    addHair(ref ? 'short' : look.hair, head, ref ? std('#bdbdbd', 0.85) : mats.hair, mats.skin);

    const headCenter = new T.Object3D();
    headCenter.position.set(0, 0.16, 0.02);
    head.add(headCenter);
    const torsoCenter = new T.Object3D();
    torsoCenter.position.set(0, 0.1, 0.03);
    chest.add(torsoCenter);

    /* ---------------- arms ---------------- */
    const arms = {};
    for (const [name, sx] of [['lead', 1], ['rear', -1]]) {
      const r1 = 0.054 * limb, r2 = 0.047 * limb;
      const upper = new T.Group();
      mk(capG(r1, D.ua + 0.02 - 2 * r1), mats.skin, upper, 0, 0, 0);
      if (ref) mk(cylG(true), mats.shirt, upper, 0, -0.03, 0, r1 + 0.018, 0.2, r1 + 0.018);
      body.add(upper);
      const fore = new T.Group();
      mk(capG(r2, D.fa + 0.02 - 2 * r2), mats.skin, fore, 0, 0, 0);
      body.add(fore);
      const glove = new T.Group();
      let fist;
      if (ref) {
        fist = mk(sphereG(), mats.skin, glove, 0, 0.06, 0, 0.055, 0.07, 0.05);
      } else {
        fist = mk(sphereG(), mats.glove, glove, 0, 0.11, 0.0, 0.108, 0.118, 0.118);
        mk(cylG(), mats.cuff, glove, 0, 0.005, 0, 0.07 * limb + 0.008, 0.07, 0.07 * limb + 0.008);
        mk(sphereG(), mats.glove, glove, sx * 0.082, 0.1, 0.0, 0.05, 0.07, 0.06);   // thumb
        mk(boxG(), mats.cuff, glove, 0, 0.115, 0.1, 0.07, 0.005, 0.02);             // strike mark
      }
      body.add(glove);
      arms[name] = { upper, fore, glove, fist, sx };
    }

    /* ---------------- legs ---------------- */
    const legs = {};
    for (const [name, sx] of [['lead', 1], ['rear', -1]]) {
      const r1 = 0.085 * limb, r2 = 0.062 * limb;
      const thigh = new T.Group();
      mk(capG(r1, D.thigh + 0.02 - 2 * r1), ref ? mats.pants : mats.skin, thigh, 0, 0, 0);
      if (!ref) {
        mk(cylG(true), mats.trunks, thigh, 0, -0.05, 0, r1 + 0.03, 0.33, r1 + 0.03);
        mk(cylG(true), mats.trim, thigh, 0, 0.113, 0, r1 + 0.033, 0.025, r1 + 0.033);
      }
      body.add(thigh);
      const shin = new T.Group();
      mk(capG(r2, D.shin + 0.02 - 2 * r2), ref ? mats.pants : mats.skin, shin, 0, 0, 0);
      if (!ref) mk(cylG(true), mats.boot, shin, 0, 0.13, 0, r2 + 0.012, 0.16, r2 + 0.012);   // boot shaft
      body.add(shin);
      const boot = new T.Group();
      mk(sphereG(), mats.boot, boot, 0, 0.0, 0.06, 0.06 * limb + 0.012, 0.062, 0.12);
      mk(boxG(), mats.sole, boot, 0, -0.07, 0.07, 0.105 * limb, 0.026, 0.27);
      body.add(boot);
      legs[name] = { thigh, shin, boot, sx };
    }

    body.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });

    return {
      root, body, pelvis, chest, head, headCenter, torsoCenter, arms, legs, mats,
      face: { eyes, pupils, brows, mouth, lips, guard, bruises, skull },
      dims: { w, t, limb, h: B.h, health: B.health },
      ref,
    };
  }

  BX.Model = { build: buildModel, BUILD, D };
})();
