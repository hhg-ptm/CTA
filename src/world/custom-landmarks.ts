import type { ChunkFeature } from './types';

/**
 * Custom Blender-authored monumental GLB overrides keyed by OSM way id (`w<id>`).
 * Served from `public/landmarks/` so both `cc-monumental` (untouched binary chunks)
 * and staging builds load dedicated landmarks while keeping procedural fallbacks intact.
 */
export const CUSTOM_LANDMARK_MODELS: Readonly<Record<string, string>> = {
  w22358108: 'landmarks/w22358108.glb', // Ayuntamiento de Cáceres (Plaza Mayor)
  w382363931: 'landmarks/w382363931.glb', // Palacio de las Veletas (Museo de Cáceres)
  w385037723: 'landmarks/w385037723.glb', // Concatedral de Santa María
  w385037728: 'landmarks/w385037728.glb', // Torre de Bujaco
  w467504814: 'landmarks/w467504814.glb', // Torre de Carvajal
};

/**
 * Resolves the safe relative landmark GLB path (`landmarks/w<id>.glb`) for a building feature,
 * honoring explicit chunk paths first and falling back to `CUSTOM_LANDMARK_MODELS`.
 */
export function resolveLandmarkModelPath(
  feature: Pick<ChunkFeature, 'id' | 'landmarkModelPath'>,
): string {
  if (feature.landmarkModelPath && /^landmarks\/w\d+\.glb$/.test(feature.landmarkModelPath)) {
    return feature.landmarkModelPath;
  }
  return feature.id ? (CUSTOM_LANDMARK_MODELS[feature.id] ?? '') : '';
}
