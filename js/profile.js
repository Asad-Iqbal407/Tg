/* Knockout Arena — persistent player profile: avatar, upgrades, career progress */
(function () {
  'use strict';
  const BX = (window.BX = window.BX || {});

  const DEFAULT = () => ({
    look: Object.assign({}, BX.DEFAULT_LOOK),
    stats: { power: 0, speed: 0, stamina: 0, chin: 0 },
    points: 3,
    career: { stage: 0, wins: 0, losses: 0, kos: 0, champion: false },
    record: { fights: 0, wins: 0, losses: 0, draws: 0, kos: 0 },
  });

  const P = {
    data: null,
    load() { P.data = BX.deepMerge(DEFAULT(), BX.store.get('profile', {})); return P.data; },
    get() { return P.data || P.load(); },
    save() { BX.store.set('profile', P.data); },
    setLook(look) { P.get().look = Object.assign({}, look); P.save(); },
    spend(stat) {
      const d = P.get();
      if (d.points > 0 && d.stats[stat] < BX.MAX_STAT) { d.stats[stat]++; d.points--; P.save(); return true; }
      return false;
    },
    refund(stat) {
      const d = P.get();
      if (d.stats[stat] > 0) { d.stats[stat]--; d.points++; P.save(); return true; }
      return false;
    },
    resetCareer() {
      const d = P.get();
      d.career = { stage: 0, wins: 0, losses: 0, kos: 0, champion: false };
      P.save();
    },
    resetAll() { P.data = DEFAULT(); P.save(); },
    /** Record the outcome of a fight and (career only) hand out progression. */
    record(res) {
      const d = P.get();
      if (res.mode === 'training') return null;
      const reward = { points: 0, stageUp: false, champion: false };
      d.record.fights++;
      if (res.winner === 0) { d.record.wins++; if (res.method === 'KO' || res.method === 'TKO') d.record.kos++; }
      else if (res.winner === 1) d.record.losses++;
      else d.record.draws++;
      if (res.cfg && res.cfg.career != null) {
        const stage = res.cfg.career;
        if (res.winner === 0) {
          d.career.wins++;
          if (res.method === 'KO' || res.method === 'TKO') d.career.kos++;
          reward.points = res.method === 'KO' || res.method === 'TKO' ? 3 : 2;
          if (stage >= d.career.stage) {
            d.career.stage = stage + 1;
            reward.stageUp = true;
            if (d.career.stage >= BX.ROSTER.length) { d.career.champion = true; reward.champion = true; reward.points += 3; }
          }
          d.points += reward.points;
        } else if (res.winner === 1) d.career.losses++;
      }
      P.save();
      return reward;
    },
  };
  BX.Profile = P;
})();
