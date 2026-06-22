import type { Startbox } from '../../../gen/types/map_list.js';

type RectCorner = { x: number; y: number };

// SPADS (mapBoxes.conf) and TEIServer/Tachyon carry only axis-aligned
// rectangles, so collapse an N-point polygon to its bounding box. The full
// polygon shape rides in the mapmetadata_startboxes_set modoption (see
// gen_map_modoptions.ts) and is decoded game-side. Legacy 2-point rectangles
// are already min/max ordered, so the bounding box is the rectangle itself.
export function polyBoundingRect(poly: Startbox['poly']): [RectCorner, RectCorner] {
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    for (const p of poly) {
        xMin = Math.min(xMin, p.x);
        yMin = Math.min(yMin, p.y);
        xMax = Math.max(xMax, p.x);
        yMax = Math.max(yMax, p.y);
    }
    return [{ x: xMin, y: yMin }, { x: xMax, y: yMax }];
}
