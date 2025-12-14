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

// Filter items to only show today's items (Bangkok timezone)
function filterTodayItems(items) {
    if (!Array.isArray(items) || items.length === 0) return [];

    const now = new Date();
    const bangkokOffset = 7 * 60; // UTC+7 in minutes
    const localOffset = now.getTimezoneOffset();
    const bangkokTime = new Date(now.getTime() + (bangkokOffset + localOffset) * 60000);

    const todayStr = bangkokTime.toISOString().split('T')[0]; // YYYY-MM-DD

    return items.filter(item => {
        // Check if item has a date/timestamp field
        let itemDate = null;

        if (item.createdAt) {
            itemDate = new Date(item.createdAt);
        } else if (item.startTime && typeof item.startTime === 'string') {
            // If startTime is just "HH:MM", assume it's today
            if (item.startTime.match(/^\d{2}:\d{2}$/)) {
                return true; // No date info, assume today
            }
            itemDate = new Date(item.startTime);
        } else if (item.closedAt) {
            itemDate = new Date(item.closedAt);
        } else if (item.storyDate) {
            // storyDate might be in format "DD/MM/YYYY" or similar
            itemDate = new Date(item.storyDate);
        }

        // If we can't determine the date, include it (assume today)
        if (!itemDate || isNaN(itemDate.getTime())) {
            return true;
        }

        // Compare dates
        const itemDateStr = itemDate.toISOString().split('T')[0];
        return itemDateStr === todayStr;
    });
}

// Format status icons for On Duty users
// Based on OP System buttons: ✓ รับเคส | 🔧 รอเคสแก้ | ❌ ไม่รับเคส | ⏳ AFK | 📤 Off Duty
function formatStatus(status) {
    const statusIcons = {
        'available': '',                    // ✓ พร้อมรับเคส (default, no icon needed)
        'in_queue': '',                     // ถึงคิว - แสดงด้วย 📍 แทน
        'waiting_fix': '🔧',                // 🔧 รอเคสแก้
        'not_accepting': '🚫',              // ❌ ไม่รับเคส
        'afk': '⏳',                        // ⏳ AFK
        'in_story': '⚔️',                  // กำลังไปสตอรี่
        'in_event': '🎉',                   // อยู่ใน Event
        'break': '☕',                      // พักเบรค
        'busy': '💼'                        // ติดธุระ
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
        // FIXED: Use "cases" not "stories"
        const cases = data.cases || [];
        const currentOP = data.currentOP || 'ไม่มี';
        const onDutyCount = (data.onDuty || []).length;

        console.log(`📊 Update: ${cases.length} cases, OP: ${currentOP}, OnDuty: ${onDutyCount}`);

        // Send/Edit messages to BOTH channels
        await updateOPChannelMessage(data);      // ห้องรันคิว OP
        await updateStoryChannelMessage(data);   // ห้องแจ้งเคสสตอรี่ (เฉพาะสตอรี่)
    }, (error) => {
        console.error('❌ Firestore listener error:', error);
    });

    // Also listen for shift summaries
    startSummaryListener();

    // Also listen for closed cases (to post history)
    startClosedCaseListener();
}

// --- Listen for Shift Summary Posts ---
function startSummaryListener() {
    if (!db) return;

    console.log('👀 Starting Firestore listener for shift_summaries...');

    // Listen for new summaries added to the collection
    db.collection('shift_summaries')
        .orderBy('createdAt', 'desc')
        .limit(1)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const summary = change.doc.data();

                    // Check if already posted to Discord
                    if (summary.postedToDiscord) return;

                    console.log('📝 New shift summary detected!');
                    await postSummaryToDiscord(summary, change.doc.id);
                }
            });
        }, (error) => {
            console.error('❌ Summary listener error:', error);
        });
}

// --- Listen for Closed Cases (post history to story channel) ---
function startClosedCaseListener() {
    if (!db) return;

    console.log('👀 Starting Firestore listener for closed_cases...');

    // Listen for new closed cases
    db.collection('closed_cases')
        .orderBy('closedAt', 'desc')
        .limit(1)
        .onSnapshot(async (snapshot) => {
            snapshot.docChanges().forEach(async (change) => {
                if (change.type === 'added') {
                    const closedCase = change.doc.data();

                    // Check if already posted to Discord
                    if (closedCase.postedToDiscord) return;

                    console.log('📖 Closed case detected! Posting history...');
                    await postClosedCaseHistory(closedCase, change.doc.id);
                }
            });
        }, (error) => {
            console.error('❌ Closed case listener error:', error);
        });
}

// --- Post Closed Case History to Story Channel ---
async function postClosedCaseHistory(closedCase, docId) {
    try {
        const channel = await client.channels.fetch(STORY_CHANNEL_ID);
        if (!channel) {
            console.error('❌ Story channel not found');
            return;
        }

        const partyA = closedCase.partyA || '?';
        const partyB = closedCase.partyB || '?';
        const location = closedCase.location || '-';
        const startTime = closedCase.startTime || '-';
        const storyDate = closedCase.storyDate || '';
        const medics = closedCase.medics || [];
        const mainMedic = medics[0] || '-';
        const wardNumber = closedCase.wardNumber || closedCase.ward || '-'; // เลขวอ
        const council = closedCase.council || closedCase.site || '-'; // สภาที่ดูแล
        const closedAt = closedCase.closedAt ? new Date(closedCase.closedAt).toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Bangkok'
        }) : '-';

        // Simple one-line format for story history
        let message = '';
        message += `⚔️ **${partyA} VS ${partyB}**\n`;
        message += `📍 ${location} | ⏰ ${startTime}→${closedAt}\n`;
        message += `👨‍⚕️ ${mainMedic}`;
        if (wardNumber !== '-') message += ` | � วอ ${wardNumber}`;
        if (council !== '-') message += ` | 🏛️ ${council}`;
        message += '\n';

        // Send to Discord
        await channel.send(message);
        console.log('✅ Closed case history posted');

        // Mark as posted
        await db.collection('closed_cases').doc(docId).update({
            postedToDiscord: true,
            postedAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error('❌ postClosedCaseHistory error:', error);
    }
}

// --- Post Shift Summary to Discord ---
async function postSummaryToDiscord(summary, docId) {
    try {
        const channel = await client.channels.fetch(OP_CHANNEL_ID);
        if (!channel) {
            console.error('❌ OP Channel not found');
            return;
        }

        // Build summary message
        const opName = summary.op || 'ไม่ระบุ';
        const supOP = summary.supOP || '-';
        const shiftType = summary.type || 'end_shift'; // end_shift, handover, force_end
        const startTime = summary.startTime || '';
        const endTime = summary.endTime || '';
        const duration = summary.duration || '';
        const onDutyList = summary.onDuty || [];
        const offDutyList = summary.offDuty || [];
        const storiesList = summary.stories || [];

        // Type label
        const typeLabels = {
            'end_shift': '🏁 จบกะ',
            'handover': '🔄 ส่งต่อ OP',
            'force_end': '⚠️ บังคับจบกะ',
            'request': '📋 Request OP'
        };
        const typeLabel = typeLabels[shiftType] || '📋 สรุปกะ';

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        let message = '';
        message += `**${typeLabel}**\n`;
        message += '════════════════════\n';
        message += `📅 วันที่: ${dateStr}\n`;
        message += `👤 OP: ${opName}\n`;
        if (supOP && supOP !== '-') {
            message += `👥 Support OP: ${supOP}\n`;
        }
        // Show times - use current time as end if not provided
        const displayStartTime = startTime || '-';
        const displayEndTime = endTime || now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
        message += `⏰ เวลา: ${displayStartTime} - ${displayEndTime}`;
        if (duration) message += ` (${duration})`;
        message += '\n';
        message += '════════════════════\n\n';

        // On Duty List
        message += `✅ **On Duty (${onDutyList.length} คน):**\n`;
        if (onDutyList.length > 0) {
            onDutyList.forEach(m => {
                const name = m.name || m;
                const badge = formatBadge(m.badge);
                message += `• ${badge} ${name}\n`;
            });
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // Off Duty List
        message += `❌ **Off Duty (${offDutyList.length} คน):**\n`;
        if (offDutyList.length > 0) {
            offDutyList.slice(0, 15).forEach(m => {
                const name = m.name || m;
                message += `• ${name}\n`;
            });
            if (offDutyList.length > 15) {
                message += `_...และอีก ${offDutyList.length - 15} คน_\n`;
            }
        } else {
            message += '_ไม่มี_\n';
        }
        message += '────────────────────\n\n';

        // Stories - separate ongoing and completed
        const ongoingStories = (summary.ongoingStories || []);  // Stories still in progress
        const closedStories = storiesList || []; // Completed stories from this shift

        // Closed Stories (completed during shift)
        message += `⚔️ **สตอรี่ที่ปิดแล้ว (${closedStories.length} เคส):**\n`;
        if (closedStories.length > 0) {
            closedStories.forEach((s, i) => {
                const partyA = s.partyA || '?';
                const partyB = s.partyB || '?';
                const medics = s.medics || s.assignedMedics || [];
                const mainMedic = medics[0]?.name || medics[0] || '-';
                const supportMedics = medics.slice(1).map(m => m.name || m).join(', ');

                message += `**สตอรี่ #${i + 1}** ระหว่าง ${partyA} VS ${partyB}\n`;
                message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
                if (supportMedics) {
                    message += `แพทย์ช่วยเหลือ : ${supportMedics}\n`;
                }
                message += '\n';
            });
        } else {
            message += '_ไม่มีสตอรี่_\n';
        }

        // Ongoing Stories (still in progress when shift ended)
        if (ongoingStories.length > 0) {
            message += '\n⚠️ **สตอรี่ที่ยังดำเนินอยู่ (' + ongoingStories.length + ' เคส):**\n';
            ongoingStories.forEach((s, i) => {
                const partyA = s.partyA || '?';
                const partyB = s.partyB || '?';
                const medics = s.medics || [];
                const mainMedic = medics[0] || 'ยังไม่มี';

                message += `**#${i + 1}** ${partyA} VS ${partyB}`;
                if (mainMedic !== 'ยังไม่มี') {
                    message += ` - 👨‍⚕️ ${mainMedic}`;
                }
                message += ' _(ยังดำเนินอยู่)_\n';
            });
        }

        message += '\n════════════════════';

        // Send to Discord
        await channel.send(message);
        console.log('✅ Summary posted to Discord');

        // Mark as posted
        await db.collection('shift_summaries').doc(docId).update({
            postedToDiscord: true,
            postedAt: admin.firestore.FieldValue.serverTimestamp()
        });

    } catch (error) {
        console.error('❌ postSummaryToDiscord error:', error);
    }
}

// --- Update OP Channel Message (Queue, On Duty, Off Duty, AFK) ---
async function updateOPChannelMessage(data) {
    try {
        const channel = await client.channels.fetch(OP_CHANNEL_ID);
        if (!channel) {
            console.error('❌ OP channel not found');
            return;
        }

        const currentOP = data.currentOP || 'ไม่มี';
        const supOP = data.supOP || null;
        const onDuty = data.onDuty || [];  // Array of strings (names)
        const offDuty = data.offDuty || []; // Array of strings (names)
        const afkList = data.afk || [];     // OP uses "afk" not "afkList"
        const lastModified = data._lastModified || null;
        const medicStatuses = data.medicStatuses || {}; // Status per medic

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // Build message for OP Channel (Queue info)
        let message = '';
        message += '**สรุปการเข้าเวร OP**\n';
        message += '────────────────────\n';
        message += `📅 วันที่: ${dateStr}\n`;
        message += `👤 OP: ${currentOP}\n`;
        if (supOP) {
            message += `👥 Support OP: ${supOP}\n`;
        }
        if (lastModified && typeof lastModified === 'number') {
            const shiftDate = new Date(lastModified);
            const timeStr = shiftDate.toLocaleTimeString('th-TH', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Bangkok'
            });
            message += `⏰ เวลา: ${timeStr}\n`;
        }
        message += '────────────────────\n\n';

        // On Duty List
        message += `✅ **On Duty (${onDuty.length} คน):**\n`;
        if (onDuty.length > 0) {
            onDuty.forEach((name) => {
                const status = medicStatuses[name] || '';
                let icon = '';
                if (status === 'accept') {
                    icon = ' 📍'; // กด ✓ รับเคส = ถึงคิว
                } else if (status === 'waitfix') {
                    icon = ' ⏳'; // รอเคสแก้
                } else if (status === 'decline') {
                    icon = ' ❌'; // ไม่รับเคส
                }
                message += `• ${name}${icon}\n`;
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

        // AFK List
        if (afkList.length > 0) {
            message += `💤 **AFK (${afkList.length} คน):**\n`;
            afkList.forEach(name => {
                const afkTime = data.afkTimes?.[name];
                let timeStr = '';
                if (afkTime) {
                    const mins = Math.floor((Date.now() - afkTime) / 60000);
                    timeStr = ` (${mins} นาที)`;
                }
                message += `• ${name}${timeStr}\n`;
            });
            message += '────────────────────\n';
        }

        // Get stored message ID for OP channel
        const configDoc = await db.collection('config').doc('discord_message').get();
        const storedMessageId = configDoc.exists ? configDoc.data().opChannelMessageId : null;

        if (storedMessageId) {
            try {
                const msg = await channel.messages.fetch(storedMessageId);
                await msg.edit(message);
                console.log('✅ OP Channel message edited');
            } catch (e) {
                const newMsg = await channel.send(message);
                await db.collection('config').doc('discord_message').set({
                    ...configDoc.data(),
                    opChannelMessageId: newMsg.id
                }, { merge: true });
                console.log('✅ OP Channel new message sent');
            }
        } else {
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                opChannelMessageId: newMsg.id
            }, { merge: true });
            console.log('✅ OP Channel initial message sent');
        }
    } catch (error) {
        console.error('❌ updateOPChannelMessage error:', error);
    }
}

// --- Update Story Channel Message (Stories Only) ---
async function updateStoryChannelMessage(data) {
    try {
        const channel = await client.channels.fetch(STORY_CHANNEL_ID);
        if (!channel) {
            console.error('❌ Story channel not found');
            return;
        }

        const allStories = data.cases || [];
        const stories = filterTodayItems(allStories);
        const allEvents = data.activeEvents || [];
        const eventList = filterTodayItems(allEvents);

        // Format date
        const now = new Date();
        const dateStr = now.toLocaleDateString('th-TH', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });

        // Build message for Story Channel (Stories & Events ONLY)
        let message = '';
        message += '**📋 แจ้งเคสสตอรี่**\n';
        message += '────────────────────\n';
        message += `📅 ${dateStr}\n`;
        message += '────────────────────\n\n';

        // Stories Only
        message += `⚔️ **สตอรี่ (${stories.length} เคส):**\n`;
        if (stories.length > 0) {
            stories.forEach((c, i) => {
                const partyA = c.partyA || '?';
                const partyB = c.partyB || '?';
                const location = c.location || '';
                const startTime = c.startTime || '';
                const medics = c.medics || [];
                const mainMedic = medics[0] || 'ยังไม่มี';
                const supportMedics = medics.slice(1).join(', ');

                message += `**สตอรี่ #${i + 1}** ${startTime ? `⏰ ${startTime}` : ''}\n`;
                message += `ระหว่าง ${partyA} VS ${partyB}\n`;
                if (location) message += `📍 ${location}\n`;
                message += `แพทย์ผู้รับผิดชอบ : ${mainMedic}\n`;
                if (supportMedics) {
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
                const participants = (e.medics || []).join(', ') || 'ยังไม่มี';
                message += `**${e.name || 'Event'}**\n`;
                message += `ผู้เข้าร่วม: ${participants}\n\n`;
            });
        }

        // Get stored message ID for Story channel
        const configDoc = await db.collection('config').doc('discord_message').get();
        const storedMessageId = configDoc.exists ? configDoc.data().storyMessageId : null;

        if (storedMessageId) {
            try {
                const msg = await channel.messages.fetch(storedMessageId);
                await msg.edit(message);
                console.log('✅ Story Channel message edited');
            } catch (e) {
                const newMsg = await channel.send(message);
                await db.collection('config').doc('discord_message').set({
                    ...configDoc.data(),
                    storyMessageId: newMsg.id
                }, { merge: true });
                console.log('✅ Story Channel new message sent');
            }
        } else {
            const newMsg = await channel.send(message);
            await db.collection('config').doc('discord_message').set({
                storyMessageId: newMsg.id
            }, { merge: true });
            console.log('✅ Story Channel initial message sent');
        }
    } catch (error) {
        console.error('❌ updateStoryChannelMessage error:', error);
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
