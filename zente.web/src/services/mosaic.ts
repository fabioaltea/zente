export type MosaicTileType = "portrait" | "square" | "landscape" | "panorama";

export function getMosaicTileType(ratio: number): MosaicTileType {
   if (ratio < 0.82) return "portrait";
   if (ratio < 1.2) return "square";
   if (ratio < 1.85) return "landscape";
   return "panorama";
}
