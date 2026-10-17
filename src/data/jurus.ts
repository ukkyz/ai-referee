import type { Jurus, JurusStep } from '../types';
import { POSE_MAP } from './poses';

const S = (id: string, t: number, hold: number, label?: string): JurusStep => {
  const pose = POSE_MAP[id];
  if (!pose) throw new Error(`Unknown pose ${id}`);
  return { uid: `${id}@${t}`, pose, t, hold, label };
};

function tunggalSimulation(): JurusStep[] {
  const cycle = [
    'sikap-pasang',
    'pukulan-lurus-kanan',
    'tangkisan-atas-kanan',
    'tendangan-depan-kanan',
    'kuda-tengah',
    'tebasan-kanan',
    'tangkisan-luar-kiri',
    'tendangan-samping-kiri',
    'pasang-rendah',
    'elakan-samping-kanan',
    'pukulan-lurus-kiri',
    'sikap-pasang-kanan',
  ];
  const steps: JurusStep[] = [S('sikap-hormat', 3, 3, 'Salam Pembuka')];
  for (let i = 0; i < 36; i++) {
    const id = cycle[i % cycle.length];
    const pose = POSE_MAP[id];
    const hold = pose.category === 'tendangan' ? 0.6 : pose.category === 'kuda-kuda' || pose.category === 'sikap' ? 1.4 : 0.9;
    steps.push(S(id, +(8 + i * 4.5).toFixed(1), hold));
  }
  steps.push(S('sikap-hormat', 175, 3, 'Salam Penutup'));
  return steps;
}

export const PRESET_JURUS: Jurus[] = [
  {
    id: 'jurus-dasar-1',
    name: 'Jurus Dasar I',
    subtitle: 'Pukulan & Tangkisan',
    description: 'Fundamental strikes and blocks — salutation, guard, straight punch, high block, horse stance chop, back-stance block and front kick.',
    level: 'Pemula',
    targetDuration: 40,
    tolerance: 3,
    steps: [
      S('sikap-hormat', 2, 2.5, 'Salam Pembuka'),
      S('sikap-pasang', 6, 1.5),
      S('pukulan-lurus-kanan', 9, 0.8),
      S('tangkisan-atas-kanan', 12, 0.8),
      S('kuda-tengah', 15.5, 1.5),
      S('tebasan-kanan', 18.5, 0.8),
      S('tangkisan-luar-kiri', 22, 1),
      S('tendangan-depan-kanan', 25.5, 0.6),
      S('pukulan-lurus-kanan', 28.5, 0.8),
      S('sikap-pasang', 32, 1.5),
      S('sikap-hormat', 37, 2.5, 'Salam Penutup'),
    ],
  },
  {
    id: 'latihan-kuda-kuda',
    name: 'Latihan Kuda-kuda',
    subtitle: 'Stance Drill',
    description: 'Slow-tempo drill to build a firm foundation: ready stance, horse stance, guard, back stance and the low side guard.',
    level: 'Pemula',
    targetDuration: 30,
    tolerance: 3,
    steps: [
      S('sikap-siap', 2, 2),
      S('kuda-tengah', 6, 2.5),
      S('sikap-pasang', 10.5, 2),
      S('tangkisan-luar-kiri', 15, 2),
      S('pasang-rendah', 19.5, 2.5),
      S('kuda-tengah', 24, 2),
      S('sikap-siap', 28, 1.5),
    ],
  },
  {
    id: 'jurus-dasar-2',
    name: 'Jurus Dasar II',
    subtitle: 'Tendangan & Kuda-kuda',
    description: 'Kicking combinations — front kick, the signature T side kick, crescent kick and a deep low guard between strikes.',
    level: 'Menengah',
    targetDuration: 45,
    tolerance: 3,
    steps: [
      S('sikap-hormat', 2, 2.5, 'Salam Pembuka'),
      S('sikap-pasang', 6, 1.5),
      S('tendangan-depan-kanan', 9, 0.6),
      S('sikap-pasang-kanan', 12, 1.2),
      S('tendangan-samping-kiri', 15.5, 0.7),
      S('kuda-tengah', 19, 1.5),
      S('tendangan-sabit-kanan', 23, 0.6),
      S('pasang-rendah', 27, 1.5),
      S('pukulan-lurus-kanan', 31, 0.8),
      S('tendangan-depan-kiri', 34.5, 0.6),
      S('sikap-pasang', 38, 1.5),
      S('sikap-hormat', 43, 2.5, 'Salam Penutup'),
    ],
  },
  {
    id: 'rangkaian-seni',
    name: 'Rangkaian Seni Tunggal',
    subtitle: 'Kombinasi Artistik',
    description: 'An artistic one-minute sequence mixing punches, blocks, evasions, kicks and low stances — judged on flow, rhythm and expression.',
    level: 'Mahir',
    targetDuration: 60,
    tolerance: 4,
    steps: [
      S('sikap-hormat', 2, 2.5, 'Salam Pembuka'),
      S('sikap-siap', 6, 1.2),
      S('sikap-pasang', 9, 1.2),
      S('pukulan-lurus-kanan', 11.5, 0.6),
      S('pukulan-lurus-kiri', 13.5, 0.6),
      S('tangkisan-atas-kanan', 16, 0.7),
      S('tendangan-depan-kanan', 18.5, 0.5),
      S('elakan-samping-kanan', 21.5, 0.8),
      S('tebasan-kanan', 24.5, 0.8),
      S('kuda-tengah', 27.5, 1.5),
      S('tendangan-samping-kiri', 31, 0.7),
      S('pasang-rendah', 35, 1.5),
      S('tangkisan-luar-kiri', 39, 1),
      S('tendangan-sabit-kanan', 42.5, 0.6),
      S('pukulan-lurus-kanan', 45.5, 0.6),
      S('sikap-pasang-kanan', 48.5, 1.2),
      S('sikap-siap', 52.5, 1.2),
      S('sikap-hormat', 57, 2.5, 'Salam Penutup'),
    ],
  },
  {
    id: 'tunggal-3-menit',
    name: 'Simulasi Tunggal 3 Menit',
    subtitle: 'Official IPSI timing · 3:00 ± 5 s',
    description: 'Competition-length simulation with 38 key movements under the official IPSI rule: 3 minutes with a 5-second tolerance and −10/−15/−20 time penalties.',
    level: 'Mahir',
    targetDuration: 180,
    tolerance: 5,
    steps: tunggalSimulation(),
  },
];
