// Load environment variables
require('dotenv').config();

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ maxInstances: 10 });

// --- UPDATE VERSION (Call after Deploy to trigger Force Refresh for all users) ---
// Usage: curl "https://asia-southeast1-medic-op.cloudfunctions.net/updateVersion?version=1.3.6&secret=medic2024"
exports.updateVersion = onRequest({ region: "asia-southeast1" }, async (req, res) => {
    const secret = req.query.secret;
    const newVersion = req.query.version;

    // Simple secret check (change this to your own secret)
    if (secret !== 'medic2024') {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!newVersion) {
        return res.status(400).json({ error: 'Missing version parameter' });
    }

    try {
        await db.collection('settings').doc('appVersion').set({
            version: newVersion,
            updatedAt: Date.now(),
            updatedBy: 'System (Post-Deploy)'
        });

        console.log(`✅ Version updated to ${newVersion}`);
        res.json({
            success: true,
            message: `Version updated to ${newVersion}. All users will get Force Refresh popup.`
        });
    } catch (error) {
        console.error('Update version error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- CONFIGURATION (from Environment Variables) ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ROLE_ID = process.env.ROLE_ID;
const LEAVE_CHANNEL_ID = process.env.LEAVE_CHANNEL_ID;
const APPROVE_CHANNEL_ID = process.env.APPROVE_CHANNEL_ID;

// --- GLOBAL STATE ---
let isClientReady = false;

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction]
});

// Event: Ready
client.once("ready", () => {
    console.log(`[Discord] Bot Ready: ${client.user.tag}`);
    logSystem('INFO', `Bot Started: ${client.user.tag}`);
    isClientReady = true;
});

// Event: Connection Error
client.on("error", (error) => {
    console.error("[Discord] Connection Error:", error);
    isClientReady = false;
});

// --- HELPER FUNCTIONS ---

// 1. Log to Firestore
async function logSystem(level, message) {
    try {
        await db.collection('system_logs').add({
            level: level, // 'INFO', 'WARN', 'ERROR'
            message: message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            source: 'bot'
        });
        console.log(`[${level}] ${message}`);
    } catch (e) {
        console.error("Failed to write system log:", e);
    }
}

// 2. Check Bot Status Config
async function isBotEnabled() {
    try {
        const doc = await db.collection('config').doc('bot_status').get();
        if (!doc.exists) return true; // Default to ON if no config
        return doc.data().active !== false;
    } catch (e) {
        console.error("Error checking bot status:", e);
        return true;
    }
}

// 3. Login Helper (Respects Config)
async function ensureBotLogin() {
    if (isClientReady) return true;

    const enabled = await isBotEnabled();
    if (!enabled) {
        console.log("Bot is disabled in config. Skipping login.");
        return false;
    }

    try {
        await client.login(DISCORD_TOKEN);
        return true;
    } catch (e) {
        console.error("Login attempt failed:", e);
        logSystem('ERROR', `Bot Auto-Login Failed: ${e.message}`);
        return false;
    }
}

// 4. Auth Check (Approvers)
async function isAuthorizedApprover(userId) {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userId);
        return member.roles.cache.has(ROLE_ID);
    } catch (e) {
        console.error("Auth Check Error:", e);
        return false;
    }
}

// 5. Parse Thai Date
function parseThaiDate(dateStr) {
    const parts = dateStr.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
    if (!parts) throw new Error("Invalid Date Format");

    let day = parseInt(parts[1]);
    let month = parseInt(parts[2]) - 1;
    let year = parseInt(parts[3]);

    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;

    return new Date(year, month, day);
}

// --- INITIALIZATION ---
// Attempt initial login on instance cold start (if enabled)
ensureBotLogin().catch(e => console.error("Initial Login Error:", e));


// --- CLOUD FUNCTIONS ---

// 1. STATUS TOGGLE (Replaces Restart)
exports.toggleBot = onCall({ region: "asia-southeast1" }, async (request) => {
    // Auth Check: request.auth should ideally be checked here
    const userId = request.auth ? request.auth.uid : "Unauthenticated";
    const newState = request.data.active; // Expect boolean

    console.log(`Toggle Bot: ${newState} by ${userId}`);

    try {
        // 1. Update Config
        await db.collection('config').doc('bot_status').set({ active: newState }, { merge: true });

        // 2. Act on Client
        if (newState === true) {
            await client.login(DISCORD_TOKEN);
            await logSystem('INFO', `Bot Enabled by Admin (${userId})`);
            return { message: "Bot Enabled & Logging In..." };
        } else {
            await client.destroy();
            isClientReady = false;
            await logSystem('WARN', `Bot Disabled by Admin (${userId})`);
            return { message: "Bot Disabled & Logged Out" };
        }
    } catch (e) {
        console.error("Toggle Failed:", e);
        throw new HttpsError('internal', `Operation failed: ${e.message}`);
    }
});


// 2. AUTO-DM (On Applicant Approval)
exports.onMedicApproved = onDocumentUpdated("applicants/{docId}", async (event) => {
    // Check Status First
    if (!await isBotEnabled()) return console.log("Bot disabled. Skipping Auto-DM.");

    const newValue = event.data.after.data();
    const previousValue = event.data.before.data();

    if (newValue.status === 'approved' && previousValue.status !== 'approved') {
        const discordId = newValue.discord_id;
        const name = newValue.ic_name || 'ไม่ระบุชื่อ';

        if (!discordId) return;

        try {
            if (!await ensureBotLogin()) return;

            const guild = await client.guilds.fetch(GUILD_ID);
            const channel = await guild.channels.fetch(APPROVE_CHANNEL_ID);

            if (channel) {
                const embed = {
                    title: "📋 ยืนยันการรับเข้าทำงาน (Approval Check)",
                    description: `โปรดตรวจสอบข้อมูลและกด ✅ เพื่อยืนยันการส่ง DM`,
                    color: 0x00ff00,
                    fields: [
                        { name: "ชื่อ (IC)", value: name, inline: true },
                        { name: "Discord ID", value: discordId, inline: true },
                        { name: "สถานะ", value: "รออนุมัติ DM", inline: true }
                    ],
                    timestamp: new Date()
                };

                const msg = await channel.send({ embeds: [embed] });
                await msg.react('✅');
                await logSystem('INFO', `Verification Embed Sent for ${name}`);
            } else {
                await logSystem('ERROR', `Approve Channel ${APPROVE_CHANNEL_ID} not found`);
            }
        } catch (error) {
            console.error("Auto-DM Error:", error);
            await logSystem('ERROR', `Auto-DM Error for ${discordId}: ${error.message}`);
        }
    }
});


// 3. SCHEDULED TASKS (Midnight Revert & Avatar Sync)
exports.checkLeaveStatus = onSchedule({
    schedule: "every day 00:01",
    timeZone: "Asia/Bangkok",
    timeoutSeconds: 300,
}, async (event) => {
    // Note: Reverting leave status is DB only, should run even if bot is off.
    // Avatar sync requires bot.

    const rosterRef = db.collection('cms_content').doc('roster');
    const doc = await rosterRef.get();
    if (!doc.exists) return;

    let rosterData = doc.data().items || [];
    const now = new Date();
    let updated = false;

    // A. Revert Leave Status
    rosterData = rosterData.map(r => {
        if (r.status === 'ลางาน' && r.statusDate) {
            const endDate = new Date(r.statusDate);
            if (now > endDate) {
                r.status = 'ปฏิบัติงาน';
                r.statusDate = null;
                updated = true;
                console.log(`Reverted status for ${r.name}`);
            }
        }
        return r;
    });

    // B. Sync Avatars (Only if Bot On)
    if (await isBotEnabled()) {
        try {
            const avatarUpdates = await syncAllAvatars(rosterData);
            if (avatarUpdates) {
                rosterData = avatarUpdates;
                updated = true;
                console.log("Synced rosters avatars from Discord");
                await logSystem('INFO', 'Synced avatars from Discord (Daily Job)');
            }
        } catch (e) {
            console.error("Avatar Sync Failed:", e);
        }
    }

    if (updated) {
        await rosterRef.update({ items: rosterData });
    }
});


// --- DISCORD EVENT HANDLERS ---

// A. Message Create (Leave Requests)
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Only process if in Leave Channel
    if (message.channelId === LEAVE_CHANNEL_ID) {
        // Date Regex: (Date) - (Date)
        const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*(?:-|to|ถึง)\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/;
        if (dateRegex.test(message.content)) {
            try {
                await message.react('✅');
                await message.react('❌');
            } catch (error) {
                console.error("React Error:", error);
            }
        }
    }
});

// B. Reaction Add (Approval Logic)
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    // Partial Handling
    if (reaction.partial) { try { await reaction.fetch(); } catch (e) { return; } }
    if (reaction.message.partial) { try { await reaction.message.fetch(); } catch (e) { return; } }

    const emojiName = reaction.emoji.name;

    // 1. APPROVAL CHANNEL (DM Trigger)
    if (reaction.message.channelId === APPROVE_CHANNEL_ID && emojiName === '✅') {
        const authorized = await isAuthorizedApprover(user.id);
        if (!authorized) return; // Silent ignore

        const embed = reaction.message.embeds[0];
        if (!embed) return;

        const idField = embed.fields.find(f => f.name === 'Discord ID');
        if (!idField) return;

        const targetId = idField.value;
        if (!targetId) return;

        try {
            const guild = await client.guilds.fetch(GUILD_ID);
            const targetMember = await guild.members.fetch(targetId).catch(() => null);

            if (targetMember) {
                const dmMessage = `ยินดีด้วย คุณ <@${targetId}> ผ่านการสัมภาษณ์แล้ว สามารถเข้าสู่ระบบเพื่อดูข้อมูลเพิ่มเติม\nWebsite : https://onemedicrecruitment-db.web.app/\nUser : ${targetId}\nPassword : 123456\n\nดิสคอร์ดแพทย์ ONE CITY\nhttps://discord.gg/qAWGuzX8zj\n\nยินดีต้อนรับสู่ทีมแพทย์ ONE CITY นะครับ/ค่ะ`;

                await targetMember.send(dmMessage);
                await reaction.message.reply(`✅ ส่งข้อความแจ้งเตือนไปยัง <@${targetId}> เรียบร้อยแล้ว`).then(m => setTimeout(() => m.delete(), 5000));
            } else {
                await reaction.message.reply(`❌ ไม่พบผู้ใช้ <@${targetId}> ใน Server`).then(m => setTimeout(() => m.delete(), 5000));
            }
        } catch (err) {
            console.error("DM Error:", err);
            await logSystem('ERROR', `Manual DM Failed for ${targetId}: ${err.message}`);
            await reaction.message.reply(`❌ ไม่สามารถส่งข้อความได้ (DM ปิดอยู่?)`).then(m => setTimeout(() => m.delete(), 5000));
        }
        return;
    }

    // 2. LEAVE CHANNEL (Status Update)
    if (reaction.message.channelId === LEAVE_CHANNEL_ID && (emojiName === '✅' || emojiName === '❌')) {
        const authorized = await isAuthorizedApprover(user.id);
        if (!authorized) return;

        if (emojiName === '✅') {
            const dateRegex = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\s*(?:-|to|ถึง)\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/;
            const match = reaction.message.content.match(dateRegex);

            if (match) {
                try {
                    const endDate = parseThaiDate(match[2]);
                    endDate.setHours(23, 59, 59, 999);
                    const authorId = reaction.message.author.id;

                    const rosterRef = db.collection('cms_content').doc('roster');
                    const doc = await rosterRef.get();

                    if (doc.exists) {
                        const rosterData = doc.data().items || [];
                        let found = false;
                        let targetName = "";

                        const updatedRoster = rosterData.map(r => {
                            if (r.discordId === authorId) {
                                found = true;
                                r.status = 'ลางาน';
                                r.statusDate = endDate.toISOString();
                                targetName = r.name;
                            }
                            return r;
                        });

                        if (found) {
                            await rosterRef.update({ items: updatedRoster });
                            const reply = await reaction.message.reply(`อนุมัติการลาของ **${targetName}** จนถึงวันที่ ${endDate.toLocaleDateString('th-TH')} เรียบร้อยครับ`);
                            await logSystem('INFO', `Leave Approved: ${targetName} until ${endDate.toLocaleDateString('th-TH')}`);
                            setTimeout(() => reply.delete().catch(() => { }), 5000);
                        }
                    }
                } catch (e) {
                    console.error("Leave Approval Error:", e);
                }
            }
        } else {
            // Reject
            const reply = await reaction.message.reply(`คำขอลาของคุณไม่ได้รับการอนุมัติ`);
            setTimeout(() => reply.delete().catch(() => { }), 5000);
        }
    }
});

// Event: Avatar Update
client.on('userUpdate', async (oldUser, newUser) => {
    try {
        if (oldUser.displayAvatarURL() !== newUser.displayAvatarURL()) {
            const newUrl = newUser.displayAvatarURL({ format: 'png', size: 512 });
            console.log(`User ${newUser.tag} changed avatar. Syncing...`);
            await updateAvatarInDb(newUser.id, newUrl);
        }
    } catch (e) { console.error(e); }
});


// Helper: Update Single Avatar
async function updateAvatarInDb(discordId, avatarUrl) {
    if (!discordId) return;
    const rosterRef = db.collection('cms_content').doc('roster');
    const doc = await rosterRef.get();
    if (!doc.exists) return;

    const items = doc.data().items || [];
    let found = false;
    const newItems = items.map(r => {
        if (r.discordId === discordId && r.imageUrl !== avatarUrl) {
            r.imageUrl = avatarUrl;
            found = true;
        }
        return r;
    });

    if (found) await rosterRef.update({ items: newItems });
}

// Helper: Bulk Sync
async function syncAllAvatars(rosterData) {
    try {
        if (!await ensureBotLogin()) return null;

        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();
        let changed = false;

        const updatedRoster = rosterData.map(r => {
            if (r.discordId && members.has(r.discordId)) {
                const member = members.get(r.discordId);
                const url = member.user.displayAvatarURL({ format: 'png', size: 512 });
                if (r.imageUrl !== url) {
                    r.imageUrl = url;
                    changed = true;
                }
            }
            return r;
        });

        return changed ? updatedRoster : null;
    } catch (e) {
        console.error("Sync Error:", e);
        return null;
    }
}
