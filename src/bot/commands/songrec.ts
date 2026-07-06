import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  getCachedProfile,
  getUserFriendCode,
  getProfilePrivate,
} from "../../db";
import { getClearList } from "../utils/embeds";
import {
  calcSongRating,
  getConstant,
  levelToNumber,
  getJacketFile,
  getChartsUnderConstant,
  isNewSong,
} from "../../constants";
import { chartKey } from "../../scraper";
import type { PlayRecord } from "../../scraper";

// 목표 랭크 후보 (SSS~SSS+ 비중을 높게)
const RANKS = [
  { name: "SS", ach: 99.0, weight: 1 },
  { name: "SS+", ach: 99.5, weight: 1.5 },
  { name: "SSS", ach: 100.0, weight: 3 },
  { name: "SSS+", ach: 100.5, weight: 3 },
];

const RANK_COLOR: Record<string, number> = {
  "SSS+": 0xd97706,
  SSS: 0xf59e0b,
  "SS+": 0xfbbf24,
  SS: 0xfbbf24,
};

export interface Recommendation {
  title: string;
  kind: "ST" | "DX";
  diff: string;
  level: number;
  currentAch: number;
  currentRS: number;
  targetRank: string;
  targetAch: number;
  targetRS: number;
  ratingDelta: number; // 실제 총 레이팅 증가분 (목표RS - max(현재RS, 해당 풀 컷라인))
  jacketFile: string | null;
}

// 레이팅 1등 상수에 따른 상한 오프셋
function ceilingOffset(topC: number): number {
  if (topC <= 12.4) return 0.5;
  if (topC <= 13.5) return 0.4;
  if (topC <= 14.4) return 0.3;
  return 0.2; // 14.5~14.9 및 15.0 이상(스펙 미정의) 기본값
}

function chartConstant(r: PlayRecord): number {
  const c = getConstant(r.title, r.musicKind, r.diff);
  return c !== null ? c : levelToNumber(r.level);
}

function weightedPick<T>(items: { item: T; weight: number }[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const i of items) {
    r -= i.weight;
    if (r < 0) return i.item;
  }
  return items[items.length - 1].item;
}

// clearJson 기반으로 레이팅이 오를 채보 count개를 추천
export function recommendCharts(
  clearRecords: PlayRecord[],
  count = 3,
): Recommendation[] {
  if (clearRecords.length === 0) return [];

  const clearMap = new Map<string, PlayRecord>();
  const newRSs: number[] = [];
  const oldRSs: number[] = [];
  let topC = 0;
  let topRS = -1;
  for (const r of clearRecords) {
    clearMap.set(chartKey(r), r);
    const C = chartConstant(r);
    const rs = calcSongRating(r.achievementVal, C, r.fc);
    if (rs > topRS) {
      topRS = rs;
      topC = C;
    }
    if (isNewSong(r.title)) newRSs.push(rs);
    else oldRSs.push(rs);
  }
  if (topC <= 0) return [];

  newRSs.sort((a, b) => b - a);
  oldRSs.sort((a, b) => b - a);
  const newFloor = newRSs.length >= 15 ? newRSs[14] : 0; // 신곡 15위 컷라인
  const oldFloor = oldRSs.length >= 35 ? oldRSs[34] : 0; // 구곡 35위 컷라인

  const upperBound = topC + ceilingOffset(topC);

  // 후보 선별
  type Candidate = {
    title: string;
    kind: "ST" | "DX";
    diff: string;
    level: number;
    currentAch: number;
    currentRS: number;
    fc: string;
    validTargets: typeof RANKS;
  };
  const candidates: Candidate[] = [];
  for (const chart of getChartsUnderConstant(upperBound)) {
    const rec = clearMap.get(`${chart.title}|${chart.kind}|${chart.diff}`);
    const userAch = rec?.achievementVal ?? 0;
    const fc = rec?.fc ?? "";
    const floor = isNewSong(chart.title) ? newFloor : oldFloor;
    const validTargets = RANKS.filter(
      (rank) =>
        rank.ach > userAch && calcSongRating(rank.ach, chart.level, fc) > floor,
    );
    if (validTargets.length === 0) continue;
    candidates.push({
      title: chart.title,
      kind: chart.kind,
      diff: chart.diff,
      level: chart.level,
      currentAch: userAch,
      currentRS: calcSongRating(userAch, chart.level, fc),
      fc,
      validTargets,
    });
  }

  // 가중 추출 (DX 비중 ↑, 비복원)
  const pool = candidates.slice();
  const chosen: Recommendation[] = [];
  while (chosen.length < count && pool.length > 0) {
    const pick = weightedPick(
      pool.map((c) => ({ item: c, weight: c.kind === "DX" ? 2 : 1 })),
    );
    pool.splice(pool.indexOf(pick), 1);
    const target = weightedPick(
      pick.validTargets.map((t) => ({ item: t, weight: t.weight })),
    );
    const targetRS = calcSongRating(target.ach, pick.level, pick.fc);
    // 실제 총 레이팅 변화: 이 채보가 이미 대상이면 현재RS를, 아니면 컷라인을 밀어냄
    const floor = isNewSong(pick.title) ? newFloor : oldFloor;
    const ratingDelta = targetRS - Math.max(pick.currentRS, floor);
    chosen.push({
      title: pick.title,
      kind: pick.kind,
      diff: pick.diff,
      level: pick.level,
      currentAch: pick.currentAch,
      currentRS: pick.currentRS,
      targetRank: target.name,
      targetAch: target.ach,
      targetRS,
      ratingDelta,
      jacketFile: getJacketFile(pick.title),
    });
  }
  return chosen;
}

export const data = new SlashCommandBuilder()
  .setName("곡추천")
  .setDescription("레이팅 대상곡 기반으로 점수 올리기 좋은 채보 3개 추천")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("조회할 유저 (생략 시 본인)")
      .setRequired(false),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const target = interaction.options.getUser("user") ?? interaction.user;
  const userId = target.id;
  if (target.id !== interaction.user.id && getProfilePrivate(target.id)) {
    await interaction.reply({
      content: `<@${target.id}> 님은 프로필을 비공개로 설정했습니다.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const friendCode = getUserFriendCode(userId);
  const cached = friendCode ? getCachedProfile(friendCode) : null;
  if (!cached) {
    const msg =
      target.id === interaction.user.id
        ? "아직 프로필이 등록되지 않았습니다. `/북마클릿` 명령어로 먼저 등록해주세요."
        : `<@${target.id}> 님은 아직 프로필을 등록하지 않았습니다.`;
    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  const clearRecords = getClearList(cached);
  if (clearRecords.length === 0) {
    await interaction.reply({
      content: "기록이 없습니다. `/북마클릿`으로 먼저 동기화해주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const recs = recommendCharts(clearRecords, 3);
  if (recs.length === 0) {
    await interaction.reply({
      content: "추천할 채보를 찾지 못했습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embeds = recs.map((r, i) => {
    const chartDelta = r.targetRS - r.currentRS;
    const cur = r.currentAch > 0 ? `${r.currentAch.toFixed(4)}%` : "미플레이";
    const newRating = cached.rating + r.ratingDelta;
    const emb = new EmbedBuilder()
      .setColor(RANK_COLOR[r.targetRank] ?? 0x9333ea)
      .setTitle(`${r.title} [${r.kind}]`)
      .addFields(
        {
          name: "채보",
          value: `\`${r.diff}\`  ·  상수 \`${r.level.toFixed(1)}\``,
          inline: true,
        },
        {
          name: "목표",
          value: `\`${r.targetRank}\` (${r.targetAch.toFixed(1)}%+)`,
          inline: true,
        },
        { name: "​", value: "​", inline: true },
        {
          name: "곡 점수",
          value: `${r.currentRS} → **${r.targetRS}** (+${chartDelta})`,
          inline: true,
        },
        {
          name: "예상 레이팅",
          value: `${cached.rating} → **${newRating}** (+${r.ratingDelta})`,
          inline: true,
        },
        { name: "​", value: "​", inline: true },
        { name: "현재", value: cur, inline: true },
      );
    if (i === 0) emb.setAuthor({ name: "곡 추천" });
    const jacket = r.jacketFile;
    if (jacket)
      emb.setThumbnail(`https://otoge-db.net/maimai/jacket/${jacket}`);
    return emb;
  });

  await interaction.reply({ embeds });
}
