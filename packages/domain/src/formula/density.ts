import type { DensityClass } from '../schemas/formula.js';

// g per ml, by density class (issue #782). A checked-in reference constant in
// `domain`, which is the species of table docs/formulas-schedules-batches.md
// sanctions ("a checked-in constant in `domain`, not a service").
//
// Three classes, not a per-ingredient table:
//   - waterLike — water, wine, vinegar (within 1% of 1:1), milk (within 3%).
//   - oil       — 8% off 1:1, on a component that is typically 3% of a formula,
//                 so ~0.2% of the dough. Worth recording, not worth agonising over.
//   - syrup     — honey, treacle, golden syrup at ~1.42. This is the class that
//                 actually breaks a flat 1:1, and a honey wholemeal loaf is a
//                 real thing.
//
// Keyed by class rather than by canon id on purpose: canon ids are
// `crypto.randomUUID()` and differ across dev, staging and prod, so a table keyed
// by them would be silently empty in every environment but the one it was written
// in.
export const DENSITY_G_PER_ML: Readonly<Record<DensityClass, number>> = {
  waterLike: 1.0,
  oil: 0.92,
  syrup: 1.42,
};

// What an ml figure is taken as when the component records no class. Water is the
// overwhelming majority of the ml in any formula.
export const DEFAULT_DENSITY_CLASS: DensityClass = 'waterLike';

export function gramsFromMillilitres(
  millilitres: number,
  density: DensityClass = DEFAULT_DENSITY_CLASS,
): number {
  return millilitres * DENSITY_G_PER_ML[density];
}
