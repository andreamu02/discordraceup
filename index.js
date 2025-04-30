// index.js

const { Client, IntentsBitField, Collection } = require("discord.js");
const token = process.env.DISCORD_BOT_TOKEN;

// —– CONFIG —– replace these IDs with your own —
const GUILD_ID = "1363046743582838844";
const REQUEST_CHANNEL_ID = "1367089768730464357";
const ROOM_ROLE_IDS = [
  "1367088762751946823",
  "1367088832473862274",
  "1367088861678669907",
  "1367088890107920425",
  "1367088943870251039",
  "1367088988191588352",
];
const INVITE_ROLE_IDS = [
  "1367099903205183508",
  "1367100020863795200",
  "1367100065352519700",
  "1367100102149406730",
  "1367100135057653912",
  "1367100217945620610",
];
// ——————————————————————————————

const bot = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
  ],
});

let queue = [];
let occupied = Array(ROOM_ROLE_IDS.length).fill(false);
let releaseTimers = new Map(); // userId → timeout

bot.once("ready", async () => {
  const commands = [
    { name: "request-room", description: "Request a free voice room" },
    { name: "release-room", description: "Release your room early" },
    {
      name: "call",
      description: "Invite someone into your room",
      options: [
        {
          name: "user",
          type: 6,
          description: "User to invite",
          required: true,
        },
      ],
    },
  ];

  const guild = await bot.guilds.fetch(GUILD_ID);
  await guild.commands.set(commands);
  console.log("Slash-commands registered and bot is online");
});

bot.on("interactionCreate", async (i) => {
  if (!i.guildId || i.guildId !== GUILD_ID) return;

  // /request-room
  if (i.commandName === "request-room") {
    let member = i.member;
    if (ROOM_ROLE_IDS.some((r) => member.roles.cache.has(r))) {
      return i.reply({ content: "You already have a room!", ephemeral: true });
    }
    queue.push(i.user.id);
    i.reply({
      content: `You are in queue position #${queue.length}.`,
      ephemeral: true,
    });
    tryAssignRoom();
  }

  // /release-room
  if (i.commandName === "release-room") {
    let member = i.member;
    let idx = ROOM_ROLE_IDS.findIndex((r) => member.roles.cache.has(r));
    if (idx === -1)
      return i.reply({
        content: "You do not hold any room role.",
        ephemeral: true,
      });
    releaseRoom(i.user.id, idx);
    return i.reply({
      content: `Your Room ${idx + 1} has been released.`,
      ephemeral: true,
    });
  }

  // /invite
  if (i.commandName === "invite") {
    let target = i.options.getMember("user");
    let member = i.member;
    let idx = ROOM_ROLE_IDS.findIndex((r) => member.roles.cache.has(r));
    if (idx === -1)
      return i.reply({
        content: "You must hold a room to invite someone.",
        ephemeral: true,
      });
    await target.roles.add(INVITE_ROLE_IDS[idx]);
    await target.send(`You have been invited to Room ${idx + 1}.`);
    return i.reply({
      content: `${target} has been invited to your Room ${idx + 1}.`,
      ephemeral: true,
    });
  }
});

// Assign free rooms to queued users
async function tryAssignRoom() {
  if (!queue.length) return;
  let guild = await bot.guilds.fetch(GUILD_ID);

  while (queue.length) {
    let userId = queue[0];
    let freeIndex = occupied.findIndex((v) => !v);
    if (freeIndex === -1) {
      // No rooms free
      (await guild.channels.fetch(REQUEST_CHANNEL_ID)).send(
        `<@${userId}> 🚫 All rooms are full. You remain in queue.`,
      );
      break;
    }

    let member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      queue.shift();
      continue;
    }

    occupied[freeIndex] = true;
    queue.shift();
    await member.roles.add(ROOM_ROLE_IDS[freeIndex]);
    (await guild.channels.fetch(REQUEST_CHANNEL_ID)).send(
      `<@${userId}> ✅ You’ve been assigned to Room ${freeIndex + 1}!`,
    );

    // Wait for them to leave voice before starting 30-min timer
  }
}

// Watch for owner leaving voice
bot.on("voiceStateUpdate", (oldState, newState) => {
  if (oldState.channel && !newState.channel) {
    let userId = oldState.id;
    let roomIndex = ROOM_ROLE_IDS.findIndex((r) =>
      oldState.member.roles.cache.has(r),
    );
    if (roomIndex !== -1) {
      if (releaseTimers.has(userId)) clearTimeout(releaseTimers.get(userId));
      let to = setTimeout(() => releaseRoom(userId, roomIndex), 30 * 60 * 1000);
      releaseTimers.set(userId, to);
    }
  }
  if (!oldState.channel && newState.channel) {
    let userId = newState.id;
    if (releaseTimers.has(userId)) {
      clearTimeout(releaseTimers.get(userId));
      releaseTimers.delete(userId);
    }
  }
});

// Release room and its invites
async function releaseRoom(userId, idx) {
  let guild = await bot.guilds.fetch(GUILD_ID);
  let member = await guild.members.fetch(userId).catch(() => null);
  if (member) await member.roles.remove(ROOM_ROLE_IDS[idx]).catch(() => {});
  let inviteRole = INVITE_ROLE_IDS[idx];
  for (let m of guild.members.cache
    .filter((m) => m.roles.cache.has(inviteRole))
    .values()) {
    await m.roles.remove(inviteRole).catch(() => {});
  }
  occupied[idx] = false;
  releaseTimers.delete(userId);
  tryAssignRoom();
}

bot.login(token);
