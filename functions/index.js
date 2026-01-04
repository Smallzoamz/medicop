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
const LEAVE_CHANNEL_ID = process.env.LEAVE_CHANNEL_ID;
const APPROVE_CHANNEL_ID = process.env.APPROVE_CHANNEL_ID;
const OP_CHANNEL_ID = process.env.OP_CHANNEL_ID;
const STORY_CHANNEL_ID = process.env.STORY_CHANNEL_ID;

// Role IDs for badge display
const ROLE_IDS = {
    'SSS+': process.env.ROLE_SSS_PLUS_ID,
    'SSS': process.env.ROLE_SSS_ID,
    'SS': process.env.ROLE_SS_ID,
    'A': process.env.ROLE_A_ID,
    'B': process.env.ROLE_B_ID,
    'C': process.env.ROLE_C_ID,
    'D': process.env.ROLE_D_ID
};

// --- GLOBAL STATE ---
let isClientReady = false;
let storyMessageId = null; // Track the message ID for editing

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
            // 1. Sync Roster Avatars
            const avatarUpdates = await syncAllAvatars(rosterData);
            if (avatarUpdates) {
                rosterData = avatarUpdates;
                updated = true;
                console.log("Synced rosters avatars from Discord");
                await logSystem('INFO', 'Synced roster avatars (Daily Job)');
            }

            // 2. Sync op_users Avatars (Discord Links)
            await syncOpUsersAvatars();

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

// Helper: Bulk Sync Roster
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

// Helper: Bulk Sync Registered Users (op_users)
async function syncOpUsersAvatars() {
    try {
        if (!await ensureBotLogin()) return;

        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        const usersSnap = await db.collection('op_users').where('discordId', '!=', null).get();
        if (usersSnap.empty) return;

        console.log(`Syncing avatars for ${usersSnap.size} linked accounts...`);
        const batch = db.batch();
        let updateCount = 0;

        for (const doc of usersSnap.docs) {
            const userData = doc.data();
            const discordId = userData.discordId;

            if (discordId && members.has(discordId)) {
                const member = members.get(discordId);
                const freshAvatar = member.user.displayAvatarURL({ format: 'png', size: 512 });

                // Update both fields to be safe and consistent
                const needsUpdate = (userData.discordAvatar !== freshAvatar) || (userData.avatar !== freshAvatar);

                if (needsUpdate) {
                    batch.update(doc.ref, {
                        discordAvatar: freshAvatar,
                        avatar: freshAvatar, // Harmonize field
                        discordUsername: member.user.username, // Refresh username too
                        lastAvatarSync: Date.now()
                    });
                    updateCount++;
                }
            }
        }

        if (updateCount > 0) {
            await batch.commit();
            console.log(`✅ Updated ${updateCount} user avatars in op_users`);
            await logSystem('INFO', `Synced ${updateCount} Discord avatars for linked accounts`);
        }
    } catch (e) {
        console.error("OpUsers Avatar Sync Failed:", e);
    }
}

// --- NEW: DISCORD INTEGRATION FUNCTIONS ---

// 6. GET DISCORD MEMBERS (List all members with roles)
exports.getDiscordMembers = onRequest({ region: "asia-southeast1" }, async (req, res) => {
    try {
        if (!await ensureBotLogin()) {
            return res.status(503).json({ error: 'Bot not available' });
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        const memberList = members.map(member => {
            // Find highest role from ROLE_IDS
            let badge = null;
            for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
                if (roleId && member.roles.cache.has(roleId)) {
                    badge = roleName;
                    break; // Take first (highest) match
                }
            }

            return {
                id: member.id,
                username: member.user.username,
                displayName: member.displayName,
                avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
                badge: badge
            };
        });

        res.json({ success: true, members: Array.from(memberList) });
    } catch (error) {
        console.error("getDiscordMembers Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 7. GET MEMBER ROLES (Get roles for specific Discord ID)
exports.getMemberRoles = onRequest({ region: "asia-southeast1" }, async (req, res) => {
    const discordId = req.query.discordId;
    if (!discordId) {
        return res.status(400).json({ error: 'Missing discordId parameter' });
    }

    try {
        if (!await ensureBotLogin()) {
            return res.status(503).json({ error: 'Bot not available' });
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);

        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }

        // Find badge from role
        let badge = null;
        for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
            if (roleId && member.roles.cache.has(roleId)) {
                badge = roleName;
                break;
            }
        }

        res.json({
            success: true,
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
            avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
            badge: badge,
            roles: member.roles.cache.map(r => ({ id: r.id, name: r.name }))
        });
    } catch (error) {
        console.error("getMemberRoles Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// 8. ON STORY UPDATED - Send/Edit message in Discord
exports.onStoryUpdated = onDocumentUpdated("op_data/current", async (event) => {
    if (!await isBotEnabled()) return console.log("Bot disabled. Skipping Story Update.");

    const newData = event.data.after.data();
    const oldData = event.data.before.data();

    // Only process if stories changed
    if (JSON.stringify(newData.stories) === JSON.stringify(oldData.stories)) return;

    try {
        if (!await ensureBotLogin()) return;

        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = await guild.channels.fetch(STORY_CHANNEL_ID);

        if (!channel) {
            console.error("Story channel not found");
            return;
        }

        // Build story embed
        const stories = newData.stories || [];
        const currentOP = newData.currentOP || 'ไม่มี';
        const supOP = newData.supOP || 'ไม่มี';

        const embed = {
            title: "📋 สรุปสถานะสตอรี่",
            color: 0x00BFFF,
            fields: [
                { name: "👤 OP", value: currentOP, inline: true },
                { name: "👥 Sup OP", value: supOP || '-', inline: true },
                { name: "📊 จำนวนสตอรี่", value: `${stories.length} เคส`, inline: true }
            ],
            timestamp: new Date()
        };

        // Add story details
        if (stories.length > 0) {
            const storyList = stories.slice(0, 10).map((s, i) => {
                const medics = (s.assignedMedics || []).map(m => m.name || m).join(', ') || 'ยังไม่มี';
                return `**${i + 1}. ${s.location || 'ไม่ระบุ'}** - ${s.partyA || '?'} vs ${s.partyB || '?'}\n└ แพทย์: ${medics}`;
            }).join('\n\n');

            embed.description = storyList;
        } else {
            embed.description = "_ไม่มีสตอรี่ในขณะนี้_";
        }

        // Get stored message ID from Firestore
        const configDoc = await db.collection('config').doc('discord_message').get();
        const storedMessageId = configDoc.exists ? configDoc.data().storyMessageId : null;

        if (storedMessageId) {
            // Try to edit existing message
            try {
                const message = await channel.messages.fetch(storedMessageId);
                await message.edit({ embeds: [embed] });
                console.log("Story message edited successfully");
            } catch (e) {
                // Message not found, send new
                const newMsg = await channel.send({ embeds: [embed] });
                await db.collection('config').doc('discord_message').set({ storyMessageId: newMsg.id });
                console.log("New story message sent");
            }
        } else {
            // No stored message, send new
            const newMsg = await channel.send({ embeds: [embed] });
            await db.collection('config').doc('discord_message').set({ storyMessageId: newMsg.id });
            console.log("Initial story message sent");
        }

        await logSystem('INFO', `Story update posted to Discord (${stories.length} stories)`);
    } catch (error) {
        console.error("onStoryUpdated Error:", error);
        await logSystem('ERROR', `Story Discord post failed: ${error.message}`);
    }
});

// 9. LINK DISCORD ACCOUNT - Store Discord ID for user
exports.linkDiscordAccount = onCall({ region: "asia-southeast1" }, async (request) => {
    const uid = request.auth ? request.auth.uid : null;
    const discordId = request.data.discordId;

    if (!uid) {
        throw new HttpsError('unauthenticated', 'User must be logged in');
    }

    if (!discordId) {
        throw new HttpsError('invalid-argument', 'Discord ID is required');
    }

    try {
        if (!await ensureBotLogin()) {
            throw new HttpsError('unavailable', 'Discord bot not available');
        }

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId).catch(() => null);

        if (!member) {
            throw new HttpsError('not-found', 'Discord member not found in server');
        }

        // Find badge
        let badge = null;
        for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
            if (roleId && member.roles.cache.has(roleId)) {
                badge = roleName;
                break;
            }
        }

        // Update user document (write to op_users which is where web reads from)
        await db.collection('op_users').doc(uid).set({
            discordId: discordId,
            discordUsername: member.user.username,
            discordAvatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
            discordBadge: badge
        }, { merge: true });

        await logSystem('INFO', `Discord linked: ${uid} -> ${discordId} (${member.user.username})`);

        return {
            success: true,
            username: member.user.username,
            avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
            badge: badge
        };
    } catch (error) {
        console.error("linkDiscordAccount Error:", error);
        throw new HttpsError('internal', error.message);
    }
});

// --- DISCORD OAuth2 LINKING ---
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1449745265547546706';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'D4rIo0UmO_bLwBehBFnXz-rzpuhtiDRy';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://us-central1-medic-op.cloudfunctions.net/discordCallback';

// Step 1: Redirect to Discord OAuth2
exports.discordAuth = onRequest({ region: "us-central1", cors: true }, async (req, res) => {
    const userId = req.query.userId;

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId parameter' });
    }

    // Store userId in state for callback
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');

    const authUrl = `https://discord.com/api/oauth2/authorize?` +
        `client_id=${DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}` +
        `&response_type=code` +
        `&scope=identify` +
        `&state=${state}`;

    res.redirect(authUrl);
});

// Step 2: Handle OAuth2 Callback
exports.discordCallback = onRequest({ region: "us-central1" }, async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    if (error) {
        return res.send(renderCallbackPage(false, 'การเชื่อมต่อถูกยกเลิก'));
    }

    if (!code || !state) {
        return res.send(renderCallbackPage(false, 'Missing code or state'));
    }

    try {
        // Decode state to get userId
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        const userId = stateData.userId;

        // Exchange code for access token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI
            })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenData.access_token) {
            console.error('Token error:', tokenData);
            return res.send(renderCallbackPage(false, 'ไม่สามารถรับ token ได้'));
        }

        // Get user info from Discord
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        const discordUser = await userResponse.json();

        if (!discordUser.id) {
            return res.send(renderCallbackPage(false, 'ไม่สามารถดึงข้อมูล Discord ได้'));
        }

        // Get member info from guild for badge
        let badge = null;
        try {
            await ensureBotLogin();
            const guild = await client.guilds.fetch(GUILD_ID);
            const member = await guild.members.fetch(discordUser.id);
            // Find badge from roles
            for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
                if (roleId && member.roles.cache.has(roleId)) {
                    badge = roleName;
                    break;
                }
            }
        } catch (e) {
            console.log('Could not get badge:', e.message);
        }

        // Update Firestore user document (write to op_users which is where web reads from)
        await db.collection('op_users').doc(userId).set({
            discordId: discordUser.id,
            discordUsername: discordUser.username,
            discordAvatar: `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`,
            discordBadge: badge,
            discordLinkedAt: Date.now()
        }, { merge: true });

        await logSystem('INFO', `Discord OAuth linked: ${userId} -> ${discordUser.id} (${discordUser.username})`);

        return res.send(renderCallbackPage(true, `เชื่อมต่อ Discord สำเร็จ: ${discordUser.username}`));

    } catch (error) {
        console.error('Discord callback error:', error);
        return res.send(renderCallbackPage(false, `เกิดข้อผิดพลาด: ${error.message}`));
    }
});

// Helper: Render callback HTML page
function renderCallbackPage(success, message) {
    const color = success ? '#10b981' : '#ef4444';
    const icon = success ? '✅' : '❌';

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Discord Link - ${success ? 'สำเร็จ' : 'ผิดพลาด'}</title>
    <style>
        body {
            font-family: 'Prompt', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }
        .card {
            background: rgba(30, 41, 59, 0.8);
            border: 1px solid ${color};
            border-radius: 16px;
            padding: 32px;
            text-align: center;
            max-width: 400px;
        }
        .icon { font-size: 64px; margin-bottom: 16px; }
        .message { font-size: 18px; color: ${color}; margin-bottom: 24px; }
        .btn {
            background: ${color};
            color: white;
            border: none;
            padding: 12px 32px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">${icon}</div>
        <div class="message">${message}</div>
        <button class="btn" onclick="tryClose()">ปิดหน้านี้</button>
        <p id="close-hint" style="display:none; font-size: 12px; color: #94a3b8; margin-top: 12px;">
            หากปิดไม่ได้ กรุณากดปิด Tab ด้วยตนเอง
        </p>
    </div>
    <script>
        function tryClose() {
            window.close();
            // If window didn't close, show hint
            setTimeout(() => {
                document.getElementById('close-hint').style.display = 'block';
            }, 500);
        }
        
        // Auto close after 3 seconds if success
        ${success ? `
        setTimeout(() => {
            window.close();
            // Show hint if couldn't close
            setTimeout(() => {
                document.getElementById('close-hint').style.display = 'block';
            }, 500);
        }, 3000);
        ` : ''}
        
        // Notify parent window
        if (window.opener) {
            window.opener.postMessage({ discordLinked: ${success} }, '*');
        }
    </script>
</body>
</html>
    `;
}
