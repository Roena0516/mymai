interface SongEntry {
  title: string;
  lev_bas_i?: string;
  lev_adv_i?: string;
  lev_exp_i?: string;
  lev_mas_i?: string;
  lev_remas_i?: string;
  dx_lev_bas_i?: string;
  dx_lev_adv_i?: string;
  dx_lev_exp_i?: string;
  dx_lev_mas_i?: string;
  dx_lev_remas_i?: string;
}

const DIFF_FIELDS: Record<string, [keyof SongEntry, keyof SongEntry]> = {
  BASIC:       ["lev_bas_i",   "dx_lev_bas_i"],
  ADVANCED:    ["lev_adv_i",   "dx_lev_adv_i"],
  EXPERT:      ["lev_exp_i",   "dx_lev_exp_i"],
  MASTER:      ["lev_mas_i",   "dx_lev_mas_i"],
  "Re:MASTER": ["lev_remas_i", "dx_lev_remas_i"],
};

const CONSTANTS_URL = "https://otoge-db.net/maimai/data/music-ex.json";

let constantMap: Map<string, number> = new Map();

export async function loadConstants(): Promise<void> {
  try {
    const res = await fetch(CONSTANTS_URL);
    const data = await res.json() as SongEntry[];
    constantMap = new Map();
    for (const song of data) {
      for (const [diff, [stField, dxField]] of Object.entries(DIFF_FIELDS)) {
        const stVal = song[stField] as string | undefined;
        const dxVal = song[dxField] as string | undefined;
        const v = parseFloat(stVal ?? "");
        const dv = parseFloat(dxVal ?? "");
        if (!isNaN(v) && v > 0) constantMap.set(`${song.title}|ST|${diff}`, v);
        if (!isNaN(dv) && dv > 0) constantMap.set(`${song.title}|DX|${diff}`, dv);
      }
    }
    console.log(`[constants] ${data.length}곡 로드 (상수 ${constantMap.size}개)`);
  } catch (e) {
    console.error("[constants] 로드 실패:", e);
  }
}

export function getConstant(title: string, musicKind: string, diff: string): number | null {
  const kind = musicKind === "DX" ? "DX" : "ST";
  const val = constantMap.get(`${title}|${kind}|${diff}`);
  if (val !== undefined) return val;
  // DX/ST 구분 없이 어느 쪽이든 있으면 fallback
  const alt = constantMap.get(`${title}|${kind === "DX" ? "ST" : "DX"}|${diff}`);
  return alt ?? null;
}
