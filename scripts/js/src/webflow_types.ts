/* eslint-disable */
/**
 * This file was automatically generated by gen_webflow_types.ts.
 * DO NOT MODIFY IT BY HAND. Instead, run make refresh_webflow_types
 */

/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "imageRef".
 */
export interface WebflowImageRef {
  fileId: string;
  url: string;
  alt?: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapFieldsRead".
 */
export interface WebflowMapFieldsRead {
  /**
   * Reference Field for "Map Tags" which should hold the "itemID", "itemID" when linking multiple tags to this map
   */
  "game-tags-ref-2"?: string[];
  /**
   * which terrain applies / matches this map the most
   */
  "terrain-types"?: string[];
  rowyid?: string;
  minimap?: WebflowImageRef;
  "minimap-photo-thumb"?: WebflowImageRef;
  minimapurl?: string;
  /**
   * Map width in elmos
   */
  width?: number;
  /**
   * Map height in elmos
   */
  height?: number;
  /**
   * Downlink to BAR CDN
   */
  downloadurl?: string;
  /**
   * Main Title / Slogan / Tagline - not the name of the map.
   */
  title?: string;
  /**
   * Extra optional subtitle to support the main Title.
   */
  subtitle?: string;
  /**
   * Long-text for describing the map, gameplay, and unique features
   */
  description?: string;
  /**
   * The mapper that made this map
   */
  author?: string;
  /**
   * Unique Sketchfab Identifier that will be used if there is a 3D sketchfab version available.
   */
  sketchfabcode?: string;
  "bg-image"?: WebflowImageRef;
  "perspective-shot"?: WebflowImageRef;
  /**
   * Additional images to be shown with more details / eye-candy
   */
  "more-images"?: WebflowImageRef[];
  "wind-min"?: number;
  "wind-max"?: number;
  "tidal-strength"?: number;
  /**
   * Maximum players or startpositions for this map
   */
  "max-players"?: number;
  /**
   * Total amount of teams that can spawn / amount of (max.) preset startboxes or amount of AllyTeams.
   */
  "team-count"?: number;
  "mini-map"?: WebflowImageRef;
  "metal-map"?: WebflowImageRef;
  "height-map"?: WebflowImageRef;
  "normal-map"?: WebflowImageRef;
  /**
   * Surface of the map (W * H)
   */
  mapsize?: number;
  "startpos-code"?: string;
  name: string;
  slug: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapFieldsWrite".
 */
export interface WebflowMapFieldsWrite {
  /**
   * Reference Field for "Map Tags" which should hold the "itemID", "itemID" when linking multiple tags to this map
   */
  "game-tags-ref-2"?: string[] | null;
  /**
   * which terrain applies / matches this map the most
   */
  "terrain-types"?: string[] | null;
  rowyid?: string | null;
  /**
   * Top-down minimap - longest side should be at least 1024px
   */
  minimap?: string | null;
  /**
   * Max width or height of 640px
   */
  "minimap-photo-thumb"?: string | null;
  minimapurl?: string | null;
  /**
   * Map width in elmos
   */
  width?: number | null;
  /**
   * Map height in elmos
   */
  height?: number | null;
  /**
   * Downlink to BAR CDN
   */
  downloadurl?: string | null;
  /**
   * Main Title / Slogan / Tagline - not the name of the map.
   */
  title?: string | null;
  /**
   * Extra optional subtitle to support the main Title.
   */
  subtitle?: string | null;
  /**
   * Long-text for describing the map, gameplay, and unique features
   */
  description?: string | null;
  /**
   * The mapper that made this map
   */
  author?: string | null;
  /**
   * Unique Sketchfab Identifier that will be used if there is a 3D sketchfab version available.
   */
  sketchfabcode?: string | null;
  /**
   * Main Background image with overview of the map in-game - Usually low perspective
   */
  "bg-image"?: string | null;
  /**
   * Transparant image that fully shows the entire map in-game - borders/map extensions should be off, and/or be removed with an image-editor or background remover.
   */
  "perspective-shot"?: string | null;
  /**
   * Additional images to be shown with more details / eye-candy
   */
  "more-images"?: string[] | null;
  "wind-min"?: number | null;
  "wind-max"?: number | null;
  "tidal-strength"?: number | null;
  /**
   * Maximum players or startpositions for this map
   */
  "max-players"?: number | null;
  /**
   * Total amount of teams that can spawn / amount of (max.) preset startboxes or amount of AllyTeams.
   */
  "team-count"?: number | null;
  "mini-map"?: string | null;
  /**
   * Metal spots layout for map - ideally in transparant PNG - though black background - white metal is also fine.
   */
  "metal-map"?: string | null;
  /**
   * PNG heightmap - probably needs converting to regular 8-bit PNG
   */
  "height-map"?: string | null;
  "normal-map"?: string | null;
  /**
   * Surface of the map (W * H)
   */
  mapsize?: number | null;
  "startpos-code"?: string | null;
  name: string;
  slug: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapTagFieldsRead".
 */
export interface WebflowMapTagFieldsRead {
  description?: string;
  color?: string;
  icon?: WebflowImageRef;
  name: string;
  slug: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapTagFieldsWrite".
 */
export interface WebflowMapTagFieldsWrite {
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  name: string;
  slug: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapTerrainFieldsRead".
 */
export interface WebflowMapTerrainFieldsRead {
  icon?: WebflowImageRef;
  description?: string;
  glow?: string;
  /**
   * Glow with set color
   */
  "show-glow"?: boolean;
  category?: string;
  name: string;
  slug: string;
}
/**
 * This interface was referenced by `undefined`'s JSON-Schema
 * via the `definition` "WebflowMapTerrainFieldsWrite".
 */
export interface WebflowMapTerrainFieldsWrite {
  icon?: string | null;
  description?: string | null;
  glow?: string | null;
  /**
   * Glow with set color
   */
  "show-glow"?: boolean | null;
  category?: ("Global Biome" | "Specific Feature" | "Water" | "Layout") | null;
  name: string;
  slug: string;
}
