/**
 * Headless test for the Tanding (duel) pipeline:
 *  1. Scoring rules (computeDuelStats) against handcrafted events.
 *  2. The AI event detector against a choreographed simulated fight
 *     (src/lib/duel/simulate) with known ground truth.
 *
 * Run: npm run test:duel
 */
import type { DuelConfig, DuelEvent } from '../src/types';
import { DuelEventDetector } from '../src/lib/duel/fightDetector';
import { applyPenaltyLadder, computeDuelStats, makeEvent } from '../src/lib/duel/rules';
import { DemoFight } from '../src/lib/duel/simulate';

let failures = 0;
function check(label: string, ok: boolean, extra = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

/* ---------------------------------------------------------------- rules */

console.log('Scoring rules:');
const config: DuelConfig = {
  merah: { name: 'Merah' },
  biru: { name: 'Biru' },
  rounds: 3,
  roundSeconds: 120,
  restSeconds: 60,
};
const handcrafted: DuelEvent[] = [
  makeEvent({ t: 5, round: 1, attacker: 'merah', technique: 'pukulan', status: 'sah', zone: 'dada' }), // +1
  makeEvent({ t: 9, round: 1, attacker: 'merah', technique: 'tendangan', status: 'sah', zone: 'rusuk', counterBonus: true }), // +3
  makeEvent({ t: 14, round: 1, attacker: 'biru', technique: 'tendangan', status: 'sah', zone: 'perut' }), // +2
  makeEvent({ t: 20, round: 1, attacker: 'biru', technique: 'pukulan', status: 'ilegal', zone: 'kepala' }), // teguran I -1
  makeEvent({ t: 30, round: 2, attacker: 'merah', technique: 'jatuhan', status: 'sah', zone: 'badan' }), // +3
  makeEvent({ t: 40, round: 2, attacker: 'biru', technique: 'kuncian', status: 'sah', zone: 'badan', duration: 2.4 }), // +4
  makeEvent({ t: 50, round: 3, attacker: 'biru', technique: 'tendangan', status: 'gagal', failReason: 'ditangkis', zone: 'tidak-kena' }),
];
const laddered = applyPenaltyLadder(handcrafted);
check('first foul = Teguran I (-1)', laddered[3].penalty === 1 && laddered[3].penaltyLevel === 'teguran-1');
const outcome = computeDuelStats(handcrafted, config, 180);
const [m, b] = outcome.fighters;
check('merah score = 1 + 3 + 3 = 7', m.score === 7, `got ${m.score}`);
check('biru score = 2 + 4 - 1 = 5', b.score === 5, `got ${b.score}`);
check('winner = merah', outcome.winner === 'merah', outcome.winBy);
check('merah sukses pukulan=1 tendangan=1 jatuhan=1', m.techniques.pukulan.sah === 1 && m.techniques.tendangan.sah === 1 && m.techniques.jatuhan.sah === 1);
check('biru kuncian=1, lockSeconds=2.4', b.techniques.kuncian.sah === 1 && Math.abs(b.lockSeconds - 2.4) < 1e-9);
check('biru ilegal counted, ditangkis counted', b.techniques.pukulan.ilegal === 1 && b.techniques.tendangan.ditangkis === 1);
check('momentum ends at +2', outcome.momentum[outcome.momentum.length - 1].diff === 2);

/* ---------------------------------------------------------------- detector */

console.log('\nDetector vs simulated fight (75 s):');
const fight = new DemoFight(75);
const truth = fight.groundTruth().segments;
const detector = new DuelEventDetector();
const detected: DuelEvent[] = [];
const fps = 30;
for (let t = 0; t <= 75; t += 1 / fps) {
  detected.push(...detector.pushFrame(t, 1, fight.frameAt(t)));
}
detected.push(...detector.flush(1));
detected.sort((a, b) => a.t - b.t);

const countTruth = (kinds: string[]) => truth.filter((s) => kinds.includes(s.kind)).length;
const countDet = (tech: string, status: string) => detected.filter((e) => e.technique === tech && e.status === status).length;

console.log('  ground truth segments:', truth.map((s) => s.kind).join(', '));
console.log('  detected events:');
for (const e of detected) {
  console.log(`    t=${e.t.toFixed(1).padStart(5)} ${e.attacker.padEnd(5)} ${e.technique.padEnd(9)} ${e.status.padEnd(6)} ${e.zone.padEnd(10)} ${e.note}`);
}

const truthPunches = countTruth(['punch']);
const truthKicks = countTruth(['kick']);
const truthLocks = countTruth(['lock']);
const truthDrops = countTruth(['takedown']);
const detPunchSah = countDet('pukulan', 'sah');
const detKickSah = countDet('tendangan', 'sah');
const detLockSah = countDet('kuncian', 'sah');
const detDropSah = countDet('jatuhan', 'sah');
const detIlegal = detected.filter((e) => e.status === 'ilegal').length;
const detBlocked = detected.filter((e) => e.failReason === 'ditangkis').length;

console.log(`\n  pukulan sah: ${detPunchSah}/${truthPunches} · tendangan sah: ${detKickSah}/${truthKicks} · kuncian sah: ${detLockSah}/${truthLocks} · jatuhan sah: ${detDropSah}/${truthDrops} · ilegal: ${detIlegal} · ditangkis: ${detBlocked}`);

check('detects most clean punches', detPunchSah >= Math.max(1, truthPunches - 1), `${detPunchSah}/${truthPunches}`);
check('detects most clean kicks', detKickSah >= Math.max(1, truthKicks - 1), `${detKickSah}/${truthKicks}`);
check('detects body locks', detLockSah >= Math.max(1, truthLocks), `${detLockSah}/${truthLocks}`);
check('detects takedowns', detDropSah >= truthDrops, `${detDropSah}/${truthDrops}`);
check('flags illegal head/groin attacks', detIlegal >= 2, `ilegal=${detIlegal}`);
check('recognises blocked punches', detBlocked >= 1, `ditangkis=${detBlocked}`);
check('no phantom takedowns', countDet('jatuhan', 'sah') <= truthDrops + 1);
check('sane total event volume', detected.length >= 8 && detected.length <= truth.length * 2 + 6, `events=${detected.length} truth=${truth.length}`);

// Full pipeline: stats from detected events must be coherent.
const full = computeDuelStats(detected, config, 75);
check('pipeline produces scores', full.fighters[0].totalAttempts + full.fighters[1].totalAttempts === detected.length);

if (failures) {
  console.error(`\n${failures} duel test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll duel tests passed.');
