import {
  Client, Events, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, MessageFlags,
  ChatInputCommandInteraction, REST, Routes,
  AttachmentBuilder,
} from "discord.js";
import { initEncryption } from "./crypto";
import { startWebServer, buildBookmarklet, setBaseUrl, getBaseUrl } from "./web";
import { getCachedProfile, loadUserSession, closeDb, getUserSyncToken, getAvatarBlob } from "./db";

const CONFIG = require("../config.json") as {
  token: string; clientId: string; guildId?: string; encryptionKey?: string;
  webPort?: number; baseUrl?: string;
};

initEncryption(CONFIG.encryptionKey);
const PORT = CONFIG.webPort ?? 3456;
if (CONFIG.baseUrl) setBaseUrl(CONFIG.baseUrl);
startWebServer(PORT);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder().setName("프로필").setDescription("내 maimai DX 프로필 보기"),
  new SlashCommandBuilder().setName("북마클릿").setDescription("프로필 동기화용 북마클릿 코드 받기"),
].map((c) => c.toJSON());

client.once(Events.ClientReady, async (c) => {
  console.log(`[maimai] ${c.user.tag}`);
  const rest = new REST({ version: "10" }).setToken(CONFIG.token);
  await rest.put(CONFIG.guildId
    ? Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId)
    : Routes.applicationCommands(CONFIG.clientId), { body: commands });
  console.log("[maimai] 준비 완료");
});

client.on(Events.InteractionCreate, async (i) => {
  if (i.isChatInputCommand()) await handleCmd(i);
});

function buildAvatarAttachment(userId: string): AttachmentBuilder | null {
  const buf = getAvatarBlob(userId);
  if (!buf) return null;
  return new AttachmentBuilder(buf, { name: "avatar.png" });
}

function ratingColor(r: number): number {
  if (r >= 15000) return 0x8b00ff;  // 🌈 rainbow
  if (r >= 14000) return 0xffd700;  // 🟡 gold
  if (r >= 13000) return 0x8c8c8c;  // ⚪ silver
  if (r >= 12000) return 0xcd7f32;  // 🟤 bronze
  if (r >= 10000) return 0xbd5dc7;  // 🟣 purple
  if (r >= 8000)  return 0xd95656;  // 🔴 red
  if (r >= 6000)  return 0xf09c3c;  // 🟠 orange
  if (r >= 4000)  return 0x5fba63;  // 🟢 green
  if (r >= 2000)  return 0x4d9eea;  // 🔵 blue
  return 0x95a5a6;                   // ⚪ silver-white
}

function sep(label: string, totalW = 36): string {
  const frame = Math.max(0, totalW - label.length - 2);
  const left = "─".repeat(Math.floor(frame / 2));
  const right = "─".repeat(Math.ceil(frame / 2));
  return left + " " + label + " " + right;
}

function profileEmb(p: NonNullable<ReturnType<typeof getCachedProfile>>, hasAvatar: boolean) {
  const stars = p.stars && p.stars !== "0" ? " · ★×" + p.stars : "";
  const emb = new EmbedBuilder()
    .setColor(ratingColor(p.rating))
    .setAuthor({ name: sep("Profile") })
    .setTitle(p.trophy || "칭호 없음")
    .setDescription(
      `**${p.playerName || "이름 없음"}**  ·  **${p.rating || 0}**\n` +
      `플레이 ${p.playCount || 0}회${stars}`
    )
    .setFooter({ text: `마지막 동기화: ${new Date(p.lastSyncedAt).toLocaleString("ko-KR")}` });
  if (hasAvatar) emb.setThumbnail("attachment://avatar.png");
  return emb;
}

function getSongList(p: NonNullable<ReturnType<typeof getCachedProfile>>): any[] {
  const raw = JSON.parse(p.recentJson || "{}");
  return Array.isArray(raw) ? raw : (raw.recent || []);
}

function songEmbeds(p: NonNullable<ReturnType<typeof getCachedProfile>>, userId: string, port: number): EmbedBuilder[] {
  const records = getSongList(p);
  const server = getBaseUrl(port);
  if (records.length === 0) {
    return [new EmbedBuilder().setColor(0x2b2d31).setDescription("기록 없음")];
  }
  const pageSize = records[0]?.track || 3;
  const slice = records.slice(0, pageSize);
  return slice.map((r: any, i: number) => {
    const kind = r.musicKind ? ` [${r.musicKind}]` : "";
    const emb = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: sep("#" + (i + 1), 34) })
      .setTitle(r.title + kind)
      .setDescription(`\`${r.diff} ${r.level}\``)
      .addFields(
        { name: "달성률", value: r.achievement, inline: true },
        { name: "플레이일", value: r.date || "-", inline: true },
      );
    emb.setThumbnail(`${server}/jacket?user=${userId}&idx=${i}`);
    return emb;
  });
}

function buildProfileReply(cached: NonNullable<ReturnType<typeof getCachedProfile>>, userId: string) {
  const avatar = buildAvatarAttachment(userId);
  const files = avatar ? [avatar] : [];
  return {
    embeds: [profileEmb(cached, !!avatar), ...songEmbeds(cached, userId, PORT)],
    files,
  };
}

async function handleCmd(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  if (interaction.commandName === "프로필") {
    const stored = loadUserSession(userId);
    if (stored?.friendCode) {
      const cached = getCachedProfile(stored.friendCode);
      if (cached) {
        await interaction.reply(buildProfileReply(cached, userId));
        return;
      }
    }
    await interaction.reply({
      content: "아직 프로필이 등록되지 않았습니다. `/북마클릿` 명령어로 먼저 등록해주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.commandName === "북마클릿") {
    const token = getUserSyncToken(userId);
    await interaction.reply({
      embeds: [new EmbedBuilder().setTitle("📋 프로필 등록").setColor(0x888888)
        .setDescription(`[maimai DX net](https://maimaidx-eng.com/maimai-mobile/)에서 북마클릿 실행`)
        .addFields({ name: "코드", value: `\`\`\`js\n${buildBookmarklet(token, PORT)}\n\`\`\`` })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
}

process.on("SIGINT", () => { closeDb(); process.exit(0); });
process.on("SIGTERM", () => { closeDb(); process.exit(0); });
client.login(CONFIG.token);
