import type { Startbox } from '../../../gen/types/map_list.js';

type RectCorner = { x: number; y: number };

// Rect-only consumers (SPADS, TEIServer/Tachyon) get a polygon's bounding box;
// the full shape still reaches the game via the mapmetadata_startboxes_set
// modoption. A 2-point rect is already min/max ordered, so it is unchanged.
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
