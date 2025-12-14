/**
 * Medical OP Systems - Discord Bot
 * For Railway 24/7 Deployment
 * 
 * Features:
 * - Read messages from OP Queue channel
 * - Send/Edit story updates
 * - Detect user roles
 * - Real-time message handling
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const admin = require('firebase-admin');

// --- Firebase Initialization ---
let db;
try {
    // For Railway: Use base64 encoded service account
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const serviceAccount = JSON.parse(
            Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString()
        );
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        // For local testing with default credentials
        admin.initializeApp();
    }
    db = admin.firestore();
    console.log('✅ Firebase initialized');
} catch (error) {
    console.error('❌ Firebase init error:', error.message);
}

// --- Configuration ---
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const OP_CHANNEL_ID = process.env.OP_CHANNEL_ID;
const STORY_CHANNEL_ID = process.env.STORY_CHANNEL_ID;

// Role IDs (ordered by rank)
const ROLE_IDS = {
    'SSS+': process.env.ROLE_SSS_PLUS_ID,
    'SSS': process.env.ROLE_SSS_ID,
    'SS': process.env.ROLE_SS_ID,
    'A': process.env.ROLE_A_ID,
    'B': process.env.ROLE_B_ID,
    'C': process.env.ROLE_C_ID,
    'D': process.env.ROLE_D_ID
};

// Role colors for embed
const ROLE_COLORS = {
    'SSS+': 0xFFD700, // Gold
    'SSS': 0xFF6B6B,  // Red
    'SS': 0xC77DFF,   // Purple  
    'A': 0x00FF7F,    // Green
    'B': 0x00BFFF,    // Blue
    'C': 0x87CEEB,    // Light Blue
    'D': 0x808080     // Gray
};

// --- Discord Client ---
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

// --- Helper Functions ---

// Get user's highest role badge
function getUserBadge(member) {
    for (const [roleName, roleId] of Object.entries(ROLE_IDS)) {
        if (roleId && member.roles.cache.has(roleId)) {
            return roleName;
        }
    }
    return null;
}

// Format role badge
function formatBadge(badge) {
    const badges = {
        'SSS+': '👑',
        'SSS': '⭐',
        'SS': '💎',
        'A': '🟢',
        'B': '🔵',
        'C': '🟡',
        'D': '⚪'
    };
    return badges[badge] || '';
}

// Format status icons for On Duty users
function formatStatus(status) {
    const statusIcons = {
        'available': '',                    // พร้อมรับเคส (default)
        'not_accepting': '🚫',              // ไม่รับเคส
        'waiting_fix': '🔧',                // รอเคสแก้
        'in_story': '⚔️',                  // กำลังไปสตอรี่
        'in_event': '🎉',                   // อยู่ใน Event
        'afk': '💤',                        // AFK
        'break': '☕',                      // พักเบรค
        'busy': '⏳'                        // ติดธุระ
    };
    return statusIcons[status] || '';
}

// Log to Firestore
async function logToFirestore(level, message) {
    if (!db) return;
    try {
        await db.collection('bot_logs').add({
            level,
            message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            source: 'railway-bot'
        });
    } catch (e) {
        console.error('Log error:', e.message);
    }
}

// --- Event: Ready ---
client.once('ready', async () => {
    console.log(`✅ Bot Ready: ${client.user.tag}`);
    console.log(`📡 Guild ID: ${GUILD_ID}`);
    console.log(`📺 Channels: OP=${OP_CHANNEL_ID}, Story=${STORY_CHANNEL_ID}`);

    await logToFirestore('INFO', `Bot started: ${client.user.tag}`);

    // Set status
    client.user.setActivity('Medical OP Systems', { type: 3 }); // Watching

    // Start Firestore listener for story updates
    startStoryListener();
});

// --- Event: Error ---
client.on('error', (error) => {
    console.error('❌ Discord Error:', error);
    logToFirestore('ERROR', `Discord error: ${error.message}`);
});

// --- Event: Message Create ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Handle OP Channel messages
    if (message.channelId === OP_CHANNEL_ID) {
        console.log(`📩 OP Channel Message from ${message.author.username}: ${message.content.substring(0, 50)}...`);

        // Parse OP-related commands or data
        // Example: Detect shift start messages
        if (message.content.includes('เริ่มกะ') || message.content.includes('Start Shift')) {
            const member = message.member;
            const badge = getUserBadge(member);

            // Log to Firestore for the web app to pick up
            if (db) {
                try {
                    await db.collection('discord_op_messages').add({
                        type: 'shift_start',
                        authorId: message.author.id,
                        authorName: member.displayName,
                        badge: badge,
                        content: message.content,
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log('✅ Logged shift start message');
                } catch (e) {
                    console.error('❌ Failed to log message:', e);
                }
            }
        }
    }
});

// --- Firestore Listener for Story Updates ---
function startStoryListener() {
    if (!db) {
        console.log('⚠️ Firebase not available, skipping Firestore listener');
        return;
    }

    console.log('👀 Starting Firestore listener for op_data/current...');

    db.collection('op_data').doc('current').onSnapshot(async (doc) => {
        if (!doc.exists) return;

        const data = doc.data();
        const stories = data.stories || [];
        const currentOP = data.currentOP || 'ไม่มี';
        const onDutyCount = (data.onDuty || []).length;

        console.log(`📊 Update: ${stories.length} stories, OP: ${currentOP}, OnDuty: ${onDutyCount}`);

        // Send/Edit message in Discord - pass entire data object
        await updateStoryMessage(data);
    }, (error) => {
        console.error('❌ Firestore listener error:', error);
    });
}

// --- Update Story Message in Discord ---
async function updateStoryMessage(data) {
    try {
        const channel = await client.channels.fetch(STORY_CHANNEL_ID);
        if (!channel) {
            console.error('❌ Story channel not found');
            return;
        }

        const stories = data.stories || [];
        const currentOP = data.currentOP || 'ไม่มี';
        const supOP = data.supOP || null;
        const onDuty = data.onDuty || [];
        const offDuty = data.offDuty || [];
        const afkList = data.afkList || [];
        const eventList = data.events || [];
        const shiftStart = data.shiftStart || null;
        const currentQueue = data.currentQueue || 0; // Index of current person in queue

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // Build message in text format (like the image)
        let message = '';
        message += '**สรุปการเข้าเวร OP**\n';
        message += '────────────────────\n';
        message += `📅 วันที่: ${dateStr}\n`;
        message += `👤 OP: ${currentOP}\n`;
        if (supOP) {
            message += `👥 Support OP: ${supOP}\n`;
        }
        if (shiftStart) {
            message += `⏰ เวลา: ${shiftStart}\n`;
        }
        message += '────────────────────\n\n';

        // On Duty List
        message += `✅ **On Duty (${onDuty.length} คน):**\n`;
        if (onDuty.length > 0) {
            onDuty.forEach((m, index) => {
                const name = m.name || m;
                const badge = formatBadge(m.badge);
                const status = formatStatus(m.status);
                // Add 📍 emoji if it's this person's turn in queue
                const turnEmoji = (index === currentQueue && !m.status) ? ' 📍' : '';

                // Format: • 👑 ชื่อ 🚫 📍
                let line = `• ${badge} ${name}`;
                if (status) line += ` ${status}`;
                if (turnEmoji) line += turnEmoji;
                message += line + '\n';
            });
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // Off Duty List
        message += `❌ **Off Duty (${offDuty.length} คน):**\n`;
        if (offDuty.length > 0) {
            offDuty.slice(0, 20).forEach(m => {
                const name = m.name || m;
                message += `• ${name}\n`;
            });
            if (offDuty.length > 20) {
                message += `_...และอีก ${offDuty.length - 20} คน_\n`;
            }
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // AFK List (if any)
        if (afkList.length > 0) {
            message += `� **AFK (${afkList.length} คน):**\n`;
            afkList.forEach(m => {
                const name = m.name || m;
                const reason = m.reason ? ` - ${m.reason}` : '';
                message += `• ${name}${reason}\n`;
            });
            message += '────────────────────\n\n';
        }

        // Stories
        message += `⚔️ **สตอรี่ (${stories.length} เคส):**\n`;
        if (stories.length > 0) {
            stories.forEach((s, i) => {
                const partyA = s.partyA || '?';
                const partyB = s.partyB || '?';
                const location = s.location || '';
                const assignedMedics = s.assignedMedics || [];
                const mainMedic = assignedMedics[0]?.name || assignedMedics[0] || 'ยังไม่มี';
                const supportMedics = assignedMedics.slice(1).map(m => m.name || m).join(', ') || '-';

                message += `**สตอรี่ #${i + 1}** ${location ? `(${location})` : ''}\n`;
                message += `ระหว่าง ${partyA} VS ${partyB}\n`;
                message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
                if (supportMedics !== '-') {
                    message += `แพทย์ช่วยเหลือ : ${supportMedics}\n`;
                }
                message += '\n';
            });
        } else {
            message += '_ไม่มีสตอรี่ในขณะนี้_\n';
        }

        // Events (if any)
        if (eventList.length > 0) {
            message += '────────────────────\n';
            message += `🎉 **Events (${eventList.length}):**\n`;
            eventList.forEach(e => {
                const participants = (e.participants || []).map(p => p.name || p).join(', ') || 'ยังไม่มี';
                message += `**${e.name || 'Event'}**\n`;
                message += `ผู้เข้าร่วม: ${participants}\n\n`;
            });
        }

        // Get stored message ID
        const configDoc = await db.collection('config').doc('discord_message').get();
        const storedMessageId = configDoc.exists ? configDoc.data().storyMessageId : null;

        if (storedMessageId) {
            try {
                const msg = await channel.messages.fetch(storedMessageId);
                await msg.edit(message);
                console.log('✅ Message edited');
            } catch (e) {
                // Message not found, send new
                const newMsg = await channel.send(message);
                await db.collection('config').doc('discord_message').set({
                    storyMessageId: newMsg.id
                });
                console.log('✅ New message sent');
            }
        } else {
            // No stored message, send new
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                storyMessageId: newMsg.id
            });
            console.log('✅ Initial message sent');
        }
    } catch (error) {
        console.error('❌ updateStoryMessage error:', error);
    }
}

// --- Get All Members with Badges (API) ---
async function getAllMembersWithBadges() {
    try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const members = await guild.members.fetch();

        return members.map(member => ({
            id: member.id,
            username: member.user.username,
            displayName: member.displayName,
            avatar: member.user.displayAvatarURL({ format: 'png', size: 128 }),
            badge: getUserBadge(member)
        }));
    } catch (error) {
        console.error('❌ getAllMembersWithBadges error:', error);
        return [];
    }
}

// --- Graceful Shutdown ---
process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down...');
    await logToFirestore('INFO', 'Bot shutting down (SIGTERM)');
    client.destroy();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down...');
    await logToFirestore('INFO', 'Bot shutting down (SIGINT)');
    client.destroy();
    process.exit(0);
});

// --- Start Bot ---
console.log('🚀 Starting Medical OP Discord Bot...');
client.login(DISCORD_TOKEN).catch((error) => {
    console.error('❌ Login failed:', error.message);
    process.exit(1);
});
